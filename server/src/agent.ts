/*
 * The agent's switchboard: everything the hub relays arrives here and is handed to the channel that owns it.
 *
 * Entities
 *   Agent          wires the hub link to the file system, terminals, scripts, windows, standalone sites, APIs and fastfetch
 *   Agent_Options  every collaborator, injected, so tests drive the whole agent with fakes and no Electron
 *   Link_Port      the part of Hub_Link the agent uses
 *   Windows_Port   the part of Window_Registry the agent uses
 *
 * Responsibilities
 *   Free-tier budget: nothing that is not an answer is sent while no page is connected; a page that connects asks for `auto_state`
 *   (scripts and windows) and is told what exists. Pictures and sound are sent only for the window a page watches.
 *   One page's request is answered to that page only (`to`); changes of shared state go to every page.
 *   The hub already checked that the sender is the owner: nothing here re-authorises, but every field is still validated.
 * Limits
 *   Does not own the Electron windows or the shell processes: those are the injected collaborators.
 */
import type { EventEmitter } from "events"
import type { Agent_Message, Agent_To_Hub, Clipboard_Data, Client_Message, Fs_Request, Hub_To_Agent, Input_Event, Relayed, Routed, Selector_Candidate, Window_Info } from "./shared/protocol.ts"
import { pack_audio, pack_video } from "./shared/codec.ts"
import { Fs_Error, handle_fs } from "./fs_channel.ts"
import type { Pty_Channel } from "./pty_channel.ts"
import type { Script_Runner } from "./runner.ts"
import type { Api_Registry } from "./api.ts"
import { serve_http } from "./api.ts"
import type { Site_Registry } from "./sites.ts"
import type { Snapshot } from "./fastfetch.ts"
import type { Incoming } from "./link.ts"

// A slow connection gets fewer pictures, never a growing queue; late sound is worse than none
export const video_backlog_bytes = 1024 * 1024
export const audio_backlog_bytes = 128 * 1024

export interface Link_Port {
    readonly buffered: number
    has_viewers(): boolean
    send(message: Routed<Agent_Message>, to?: string): boolean
    send_hub(message: Agent_To_Hub): boolean
    send_binary(packet: Uint8Array): boolean
}

// Events: 'added' (info), 'updated' (info), 'removed' (id), 'frame' (id, jpeg), 'audio' (id, timestamp, opus), 'hover' (id, seq, candidates), 'clipboard' (data)
export interface Windows_Port extends EventEmitter {
    list(): Window_Info[]
    owner_of(id: number): number
    close(id: number): Promise<void>
    navigate(id: number, target: { url?: string, delta?: -1 | 0 | 1 }): Promise<void>
    resize(id: number, size: { width: number, height: number } | null): Promise<void>
    devtools(id: number, open: boolean): Promise<void>
    watch(id: number | null, max_width: number, wants_audio?: boolean): Promise<void>
    input(id: number, input: Input_Event): Promise<void>
    copy(id: number, cut?: boolean): void
    paste(id: number, data: Clipboard_Data): Promise<void>
}

export interface Agent_Options {
    link: Link_Port
    runner: Script_Runner
    windows: Windows_Port
    sites: Site_Registry
    apis: Api_Registry
    pty: Pty_Channel
    fs_root: string
    snapshot: () => Promise<Snapshot>
}

type Watch = { id: number, max_width: number, audio: boolean }
type Message_Of<Type extends Client_Message["t"]> = Relayed<Extract<Client_Message, { t: Type }>>

const is_id = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0

export class Agent {
    readonly #o: Agent_Options
    // What each connected page looks at: a window is only streamed while somebody watches it
    readonly #watching = new Map<string, Watch>()

    constructor(options: Agent_Options) {
        this.#o = options
        this.#listen_runner()
        this.#listen_windows()
        options.apis.on_change = () => this.publish_apis()
    }

    // Called when the link (re)opens: the hub forgets the endpoint map when the agent goes away
    publish_apis(): void {
        this.#o.link.send_hub({ t: "api_set", apis: this.#o.apis.list() })
    }

    // Called when the link drops: nobody is watching anymore, and the shells of the pages are gone with them
    on_link_closed(): void {
        this.#watching.clear()
        this.#o.pty.close_all()
        void this.#sync_watch()
    }

    handle(message: Incoming): void {
        switch (message.t) {
            case "viewers": return this.#on_viewers(message.count)
            case "peer_gone": return this.#drop_peer(message.peer)
            case "api_req": return void serve_http(this.#o.apis, message).then(answer => this.#o.link.send_hub({ t: "api_res", ...answer }))
            case "fastfetch_req": return void this.#snapshot().then(snapshot => this.#o.link.send_hub({ t: "fastfetch_res", id: message.id, text: snapshot.text, taken_at: snapshot.taken_at }))
            default: return this.#from_page(message)
        }
    }

    // ---- pages -----------------------------------------------------------------------------------------------------------------------

    #from_page(message: Relayed<Client_Message>): void {
        const peer = message.peer
        switch (message.t) {
            case "fs": return void this.#fs(message)
            case "pty_open": case "pty_input": case "pty_resize": case "pty_close": return this.#o.pty.handle(message)
            case "auto_state": return this.#send_state(peer)
            case "auto_start": return void this.#o.runner.start(String(message.path))
            case "auto_stop": return void this.#o.runner.stop(String(message.path))
            case "auto_delete": return void this.#o.runner.remove(String(message.path))
            case "auto_logs": return void this.#o.link.send({ t: "auto_logs", path: String(message.path), entries: this.#o.runner.logs(String(message.path)) }, peer)
            case "auto_clear_logs": return this.#o.runner.clear_logs(String(message.path))
            case "fastfetch": return void this.#snapshot().then(snapshot => this.#o.link.send({ t: "fastfetch", text: snapshot.text, taken_at: snapshot.taken_at }, peer))
            case "site_open": return void this.#o.sites.open(message.key, message.url)
            case "site_close": return void this.#o.sites.close(message.key)
            case "feed_watch": return this.#watch(peer, message)
            case "window_input": return void (is_id(message.id) && this.#o.windows.input(message.id, message.input))
            case "window_navigate": return void (is_id(message.id) && this.#o.windows.navigate(message.id, { url: typeof message.url === "string" ? message.url : undefined, delta: [-1, 0, 1].includes(message.delta as number) ? message.delta : undefined }))
            case "window_close": return void (is_id(message.id) && this.#o.windows.close(message.id))
            case "window_create": return void this.#o.runner.open_window(String(message.script))
            case "window_devtools": return void (is_id(message.id) && this.#o.windows.devtools(message.id, message.open === true))
            case "window_resize": return void (is_id(message.id) && this.#o.windows.resize(message.id, message.size))
            case "clipboard_copy": return void (is_id(message.id) && this.#o.windows.copy(message.id, message.cut === true))
            case "clipboard_paste": return void (is_id(message.id) && this.#o.windows.paste(message.id, message.data))
        }
    }

    async #fs(message: Message_Of<"fs">): Promise<void> {
        const { id, peer } = message
        if (!is_id(id)) return
        try {
            const { t: _t, id: _id, peer: _peer, ...request } = message
            const result = await handle_fs(this.#o.fs_root, request as Fs_Request)
            this.#o.link.send({ t: "fs_ok", id, result }, peer)
        } catch (error) {
            const known = error instanceof Fs_Error
            this.#o.link.send({ t: "fs_err", id, code: known ? error.code : "EIO", message: known ? error.message : "Input/output error" }, peer)
        }
    }

    #send_state(peer: string): void {
        this.#o.link.send({ t: "auto_state", scripts: this.#o.runner.list() }, peer)
        this.#o.link.send({ t: "windows", windows: this.#o.windows.list() }, peer)
    }

    async #snapshot(): Promise<Snapshot> {
        return this.#o.snapshot()
    }

    // ---- watching --------------------------------------------------------------------------------------------------------------------

    #watch(peer: string, message: Message_Of<"feed_watch">): void {
        if (message.id === null) this.#watching.delete(peer)
        else if (is_id(message.id)) {
            // Re-inserted so that the newest request is the last one
            this.#watching.delete(peer)
            this.#watching.set(peer, { id: message.id, max_width: Number(message.max_width) || 1280, audio: message.audio === true })
        }
        void this.#sync_watch()
    }

    #drop_peer(peer: string): void {
        this.#o.pty.drop_peer(peer)
        if (this.#watching.delete(peer)) void this.#sync_watch()
    }

    #on_viewers(count: unknown): void {
        // Nobody left: stop capturing at once, whatever the pages did before they went
        if (Number(count) > 0) return
        this.#watching.clear()
        void this.#sync_watch()
    }

    // Only one window is streamed at a time: the one most recently asked for, as sharp as the widest page watching it
    async #sync_watch(): Promise<void> {
        const last = [...this.#watching.values()].at(-1)
        const same = [...this.#watching.values()].filter(watch => watch.id === last?.id)
        await this.#o.windows.watch(last?.id ?? null, Math.max(0, ...same.map(watch => watch.max_width)), same.some(watch => watch.audio))
    }

    #watchers_of(window_id: number): string[] {
        return [...this.#watching].filter(([, watch]) => watch.id === window_id).map(([peer]) => peer)
    }

    // ---- what changes by itself ------------------------------------------------------------------------------------------------------

    // Shared changes go to every page, and only while one is connected
    #broadcast(message: Agent_Message): void {
        if (this.#o.link.has_viewers()) this.#o.link.send(message)
    }

    #listen_runner(): void {
        const { runner } = this.#o
        runner.on("log", (path, entry) => this.#broadcast({ t: "auto_log", path, entry }))
        runner.on("status", (path, running) => this.#broadcast({ t: "auto_status", path, running }))
        runner.on("deleted", path => this.#broadcast({ t: "auto_deleted", path }))
        runner.on("logs_cleared", path => this.#broadcast({ t: "auto_logs_cleared", path }))
    }

    #listen_windows(): void {
        const { windows } = this.#o
        windows.on("added", window => this.#broadcast({ t: "window_added", window }))
        windows.on("updated", window => this.#broadcast({ t: "window_updated", window }))
        windows.on("removed", id => {
            this.#broadcast({ t: "window_removed", id })
            for (const [peer, watch] of [...this.#watching]) if (watch.id === id) this.#watching.delete(peer)
        })
        windows.on("frame", (id: number, jpeg: Uint8Array) => this.#frame(id, jpeg))
        windows.on("audio", (id: number, timestamp: number, opus: Uint8Array) => this.#audio(id, timestamp, opus))
        windows.on("clipboard", (data: Clipboard_Data) => { for (const peer of this.#watching.keys()) this.#o.link.send({ t: "clipboard", data }, peer) })
        windows.on("hover", (id: number, seq: number, candidates: Selector_Candidate[]) => {
            for (const peer of this.#watchers_of(windows.owner_of(id))) this.#o.link.send({ t: "window_hover", id, seq, selector: candidates[0]?.selector ?? "", candidates }, peer)
        })
    }

    #frame(id: number, jpeg: Uint8Array): void {
        if (this.#o.link.buffered >= video_backlog_bytes || !this.#o.link.has_viewers()) return
        if (this.#watchers_of(this.#o.windows.owner_of(id)).length === 0) return
        this.#o.link.send_binary(pack_video(id, jpeg))
    }

    #audio(id: number, timestamp: number, opus: Uint8Array): void {
        if (this.#o.link.buffered >= audio_backlog_bytes || !this.#o.link.has_viewers()) return
        if (![...this.#watching.values()].some(watch => watch.id === id && watch.audio)) return
        this.#o.link.send_binary(pack_audio(id, timestamp, opus))
    }
}
