/*
 * The page's connection to the Pi through the Server_Hub Durable Object (wire contract: server/src/shared/protocol.ts).
 *
 * Entities
 *   fetch_public_status   GET /api/server: online flag, owner flag and the (at most one minute old) fastfetch snapshot
 *   Server_Link           the owner's WebSocket: request/answer for the filesystem, subscriptions by message type, binary feed frames,
 *                         heartbeat and reconnect with backoff
 *   Fs_Error              a filesystem failure of the Pi, carrying the errno-like code
 * Scope
 *   No DOM and no globals except the injected socket factory, so it runs under node:test with a fake socket.
 *   Only owners can open the socket (the Worker refuses everybody else); visitors only ever call fetch_public_status.
 * Limits
 *   Free tier: the heartbeat is the text "ping", answered by the Durable Object without waking it; nothing else is sent while idle.
 *   Requests time out after 30 s (60 s for writes of a chunk); a lost socket fails every pending request at once.
 */
import { heartbeat_ping, heartbeat_pong, parse_message } from "../../../server/src/shared/protocol.ts"
import type { Client_Message, Fs_Code, Fs_Request, Fs_Result, Public_Status } from "../../../server/src/shared/protocol.ts"
import { unpack_binary, type Binary_Frame } from "../../../server/src/shared/codec.ts"

export class Fs_Error extends Error {
    code: Fs_Code | "OFFLINE" | "TIMEOUT"
    constructor(code: Fs_Error["code"], message: string) { super(message); this.code = code; this.name = "Fs_Error" }
}

export async function fetch_public_status(fetcher: typeof fetch = fetch, origin = ""): Promise<Public_Status> {
    const response = await fetcher(`${origin}/api/server`, { headers: { accept: "application/json" }, credentials: "same-origin" })
    if (!response.ok) throw new Error(`Server status: ${response.status}`)
    const value = await response.json() as Partial<Public_Status>
    return { online: Boolean(value.online), owner: Boolean(value.owner), snapshot: value.snapshot ?? null, stale: Boolean(value.stale) }
}

export type Socket_Like = {
    readyState: number
    binaryType: string
    send(data: string): void
    close(): void
    onopen: (() => void) | null
    onclose: (() => void) | null
    onerror: (() => void) | null
    onmessage: ((event: { data: unknown }) => void) | null
}
export type Socket_Factory = (url: string) => Socket_Like
export type Link_Options = { url: string, make_socket?: Socket_Factory, ping_ms?: number, timeout_ms?: number, backoff_ms?: number[], timers?: Timer_Api }
export type Timer_Api = { set: (fn: () => void, ms: number) => unknown, clear: (id: unknown) => void, set_interval: (fn: () => void, ms: number) => unknown }
type Pending = { resolve: (value: Fs_Result) => void, reject: (error: Error) => void, timer: unknown }
type Handler = (message: { t: string, [key: string]: unknown }) => void

const open_state = 1
const real_timers: Timer_Api = { set: (fn, ms) => setTimeout(fn, ms), clear: id => clearTimeout(id as number), set_interval: (fn, ms) => setInterval(fn, ms) }

export function default_socket_url(location_like: { protocol: string, host: string } = location): string {
    return `${location_like.protocol === "https:" ? "wss:" : "ws:"}//${location_like.host}/api/server/ws`
}

export class Server_Link {
    peer = ""
    // whether the Pi's agent is connected to the hub (not whether this socket is open)
    online = false
    connected = false
    readonly #options: Required<Omit<Link_Options, "make_socket" | "timers">> & { make_socket: Socket_Factory, timers: Timer_Api }
    #socket: Socket_Like | null = null
    #wanted = false
    #attempt = 0
    #next_id = 1
    #pending = new Map<number, Pending>()
    #handlers = new Map<string, Set<Handler>>()
    #binary = new Set<(frame: Binary_Frame) => void>()
    #state = new Set<() => void>()
    #ping: unknown = null
    #retry: unknown = null

    constructor(options: Link_Options) {
        this.#options = {
            url: options.url, ping_ms: options.ping_ms ?? 30_000, timeout_ms: options.timeout_ms ?? 30_000, backoff_ms: options.backoff_ms ?? [1000, 2000, 5000, 15_000, 30_000],
            make_socket: options.make_socket ?? (url => { const socket = new WebSocket(url); return socket as unknown as Socket_Like }),
            timers: options.timers ?? real_timers,
        }
    }

    on(type: string, handler: Handler): () => void {
        let set = this.#handlers.get(type)
        if (!set) this.#handlers.set(type, (set = new Set()))
        set.add(handler)
        return () => { set.delete(handler) }
    }

    on_binary(handler: (frame: Binary_Frame) => void): () => void { this.#binary.add(handler); return () => { this.#binary.delete(handler) } }
    // called whenever `connected` or `online` changes
    on_state(handler: () => void): () => void { this.#state.add(handler); return () => { this.#state.delete(handler) } }

    open(): void {
        if (this.#wanted) return
        this.#wanted = true
        this.#connect()
    }

    close(): void {
        this.#wanted = false
        this.#stop_timers()
        const socket = this.#socket
        this.#socket = null
        socket?.close()
        this.#lose("The connection was closed")
    }

    send(message: Client_Message): boolean {
        if (!this.#socket || this.#socket.readyState !== open_state) return false
        this.#socket.send(JSON.stringify(message))
        return true
    }

    fs(request: Fs_Request, timeout_ms = this.#options.timeout_ms): Promise<Fs_Result> {
        if (!this.connected || !this.online) return Promise.reject(new Fs_Error("OFFLINE", "The server is offline"))
        const id = this.#next_id++
        return new Promise<Fs_Result>((resolve, reject) => {
            const timer = this.#options.timers.set(() => { this.#pending.delete(id); reject(new Fs_Error("TIMEOUT", "The server did not answer")) }, timeout_ms)
            this.#pending.set(id, { resolve, reject, timer })
            if (!this.send({ t: "fs", id, ...request } as Client_Message)) { this.#pending.delete(id); this.#options.timers.clear(timer); reject(new Fs_Error("OFFLINE", "The server is offline")) }
        })
    }

    #set_state(connected: boolean, online: boolean): void {
        if (connected === this.connected && online === this.online) return
        this.connected = connected
        this.online = online
        for (const handler of [...this.#state]) handler()
    }

    #connect(): void {
        if (!this.#wanted) return
        const socket = this.#options.make_socket(this.#options.url)
        socket.binaryType = "arraybuffer"
        this.#socket = socket
        socket.onopen = () => {
            this.#attempt = 0
            this.#ping = this.#options.timers.set_interval(() => { if (socket.readyState === open_state) socket.send(heartbeat_ping) }, this.#options.ping_ms)
        }
        socket.onmessage = event => this.#receive(event.data)
        socket.onclose = () => {
            if (this.#socket !== socket) return
            this.#socket = null
            this.#stop_timers()
            this.#lose("The connection was lost")
            if (!this.#wanted) return
            const delays = this.#options.backoff_ms
            const delay = delays[Math.min(this.#attempt++, delays.length - 1)]
            this.#retry = this.#options.timers.set(() => { this.#retry = null; this.#connect() }, delay)
        }
        socket.onerror = () => undefined
    }

    #stop_timers(): void {
        if (this.#ping !== null) this.#options.timers.clear(this.#ping)
        if (this.#retry !== null) this.#options.timers.clear(this.#retry)
        this.#ping = this.#retry = null
    }

    #lose(reason: string): void {
        for (const [id, pending] of [...this.#pending]) { this.#pending.delete(id); this.#options.timers.clear(pending.timer); pending.reject(new Fs_Error("OFFLINE", reason)) }
        this.#set_state(false, false)
        for (const handler of [...(this.#handlers.get("disconnected") ?? [])]) handler({ t: "disconnected" })
    }

    #receive(data: unknown): void {
        if (typeof data === "string") {
            if (data === heartbeat_pong) return
            const message = parse_message(data, hub_and_agent_types)
            if (message) this.#dispatch(message)
            return
        }
        if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
            const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
            const frame = unpack_binary(bytes)
            if (frame) for (const handler of [...this.#binary]) handler(frame)
        }
    }

    #dispatch(message: { t: string, [key: string]: unknown }): void {
        switch (message.t) {
            case "welcome": this.peer = String(message.peer ?? ""); this.#set_state(true, Boolean(message.online)); break
            case "status": this.#set_state(this.connected, Boolean(message.online)); break
            case "fs_ok": case "fs_err": {
                const id = Number(message.id)
                const pending = this.#pending.get(id)
                if (!pending) return
                this.#pending.delete(id)
                this.#options.timers.clear(pending.timer)
                if (message.t === "fs_ok") pending.resolve(message.result as Fs_Result)
                else pending.reject(new Fs_Error(message.code as Fs_Code, String(message.message ?? message.code)))
                return
            }
        }
        for (const handler of [...(this.#handlers.get(message.t) ?? [])]) handler(message)
    }
}

const hub_and_agent_types: ReadonlySet<string> = new Set([
    "welcome", "status", "fs_ok", "fs_err", "pty_out", "pty_exit", "pty_err", "auto_state", "auto_logs", "auto_log", "auto_status", "auto_logs_cleared", "auto_error",
    "fastfetch", "windows", "window_added", "window_updated", "window_removed", "window_hover", "clipboard",
])
