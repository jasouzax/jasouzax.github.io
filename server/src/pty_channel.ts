/*
 * The terminal channel: the page's `pty_*` messages become real shells of the Pi.
 *
 * Entities
 *   Pty_Channel   owns every open shell, keyed by the page (peer) and the id that page chose
 *
 * Responsibilities
 *   At most max_sessions shells at once; a page's shells end when that page disconnects.
 *   Output is base64 in both directions so no byte sequence is split or mangled by JSON.
 *   Output pauses while the link to the Worker is backed up, instead of buffering without bound.
 * Limits
 *   Opens only the account's own shell, in a folder that exists; the page never supplies a command.
 */
import { existsSync, statSync } from "fs"
import { basename, dirname, join } from "path"
import { userInfo } from "os"
import type { Agent_Message, Client_Message, Relayed, Routed } from "../../shared/protocol/wire.ts"
import { from_base64, to_base64 } from "../../shared/protocol/codec.ts"
import { open_pty, pick_backend } from "./pty.ts"
import type { Pty_Backend, Pty_Events, Pty_Options, Pty_Session } from "./pty.ts"

export const max_sessions = 8
export const backlog_limit_bytes = 1024 * 1024

export type Open_Pty = (options: Pty_Options, events: Pty_Events) => Pty_Session
export type Pty_Channel_Options = {
    // Where pty_shim.py lives
    shim: string
    send: (message: Routed<Agent_Message>, to: string) => boolean
    // Bytes waiting on the link to the Worker
    buffered: () => number
    open?: Open_Pty
    backend?: Pty_Backend
    shell?: string
    home?: string
}

type Pty_Message = Relayed<Extract<Client_Message, { t: "pty_open" | "pty_input" | "pty_resize" | "pty_close" }>>

const clamp = (value: unknown, low: number, high: number, fallback: number) => Number.isInteger(value) ? Math.max(low, Math.min(value as number, high)) : fallback

function pick_shell(): string {
    return [process.env.SHELL, userInfo().shell, "/bin/bash", "/bin/sh"].find(shell => shell && existsSync(shell)) ?? "/bin/sh"
}

export class Pty_Channel {
    readonly #options: Pty_Channel_Options
    readonly #sessions = new Map<string, { session: Pty_Session, peer: string, id: number, paused: boolean }>()
    #pump: NodeJS.Timeout | null = null

    constructor(options: Pty_Channel_Options) {
        this.#options = options
    }

    get count(): number {
        return this.#sessions.size
    }

    handle(message: Pty_Message): void {
        const key = `${message.peer}:${message.id}`
        if (message.t === "pty_open") return this.#open(key, message)
        const entry = this.#sessions.get(key)
        // Input or a resize racing with a shell that just ended is normal
        if (!entry) return
        if (message.t === "pty_input") {
            if (typeof message.data !== "string") return
            try { entry.session.write(Buffer.from(from_base64(message.data))) } catch { /* bad base64: ignore */ }
        } else if (message.t === "pty_resize") entry.session.resize(clamp(message.cols, 1, 500, 80), clamp(message.rows, 1, 300, 24))
        else entry.session.close()
    }

    drop_peer(peer: string): void {
        for (const entry of this.#sessions.values()) if (entry.peer === peer) entry.session.close()
    }

    close_all(): void {
        for (const entry of this.#sessions.values()) entry.session.close()
    }

    #open(key: string, message: Extract<Pty_Message, { t: "pty_open" }>): void {
        const { peer, id } = message
        const fail = (text: string) => void this.#options.send({ t: "pty_err", id, message: text }, peer)
        if (!Number.isInteger(id) || this.#sessions.has(key)) return fail("bad terminal id")
        if (this.#sessions.size >= max_sessions) return fail(`at most ${max_sessions} terminals at once`)
        const shell = this.#options.shell ?? pick_shell()
        const home = this.#options.home ?? userInfo().homedir
        const cwd = typeof message.cwd === "string" && message.cwd.startsWith("/") && existsSync(message.cwd) && statSync(message.cwd).isDirectory() ? message.cwd : home
        const env = { ...process.env, HOME: home, USER: userInfo().username, LOGNAME: userInfo().username, SHELL: shell, TERM: "xterm-256color", COLORTERM: "truecolor" }
        const open = this.#options.open ?? open_pty
        const events: Pty_Events = {
            on_data: chunk => this.#output(key, chunk),
            on_exit: code => {
                this.#sessions.delete(key)
                this.#options.send({ t: "pty_exit", id, code }, peer)
            },
        }
        try {
            const shell_args = basename(shell) === "bash" ? ["--rcfile", join(dirname(this.#options.shim), "terminal.bashrc"), "-i"] : undefined
            const session = open({ shell_args, cols: clamp(message.cols, 1, 500, 80), rows: clamp(message.rows, 1, 300, 24), cwd, shell, env, backend: this.#options.backend ?? pick_backend(), shim: this.#options.shim }, events)
            this.#sessions.set(key, { session, peer, id, paused: false })
        } catch (error) {
            fail(error instanceof Error ? error.message : "could not start a shell")
        }
    }

    #output(key: string, chunk: Buffer): void {
        const entry = this.#sessions.get(key)
        if (!entry) return
        this.#options.send({ t: "pty_out", id: entry.id, data: to_base64(chunk) }, entry.peer)
        if (!entry.paused && this.#options.buffered() > backlog_limit_bytes) {
            entry.paused = true
            entry.session.pause()
            this.#start_pump()
        }
    }

    // Resumes paused shells once the link has drained
    #start_pump(): void {
        if (this.#pump) return
        this.#pump = setInterval(() => {
            if (this.#options.buffered() > backlog_limit_bytes / 4) return
            for (const entry of this.#sessions.values()) if (entry.paused) { entry.paused = false; entry.session.resume() }
            clearInterval(this.#pump!)
            this.#pump = null
        }, 50)
        this.#pump.unref()
    }
}
