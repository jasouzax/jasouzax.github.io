/*
 * The page side of the device bridge: talks to the JAZU extension, which talks to the native host on this machine.
 * Entities:
 *   connect_host   - handshake with the extension and host; resolves with the host's facts or rejects with a readable reason
 *   open_session   - one real shell on the device (a pty), with output/exit callbacks
 *   host_programs  - { host_sh }: the kernel program that shows such a shell in a terminal window (same streams as any process)
 *   probe_host     - connects quietly so the "Open terminal" button can prefer the device shell when the bridge exists
 * Scope:
 *   Only window.postMessage in the "jazu-host" envelope; the extension's content script is the other end. No network, no storage.
 *   Without the extension nothing answers: every call fails after a short timeout and the desk keeps using its WASM shell.
 *   Bytes travel as base64; output is decoded as streaming UTF-8 so a multi-byte character split across chunks stays whole.
 */
import type { proc_api, program } from "./proc_types.ts"
import { terminal_hooks } from "./desk_view.ts"
import { text } from "./desk.ts"

export type Host_Info = { version: string, user: string, hostname: string, home: string, shell: string, pty: string }

export type Host_Session = { write: (data: string) => void, resize: (cols: number, rows: number) => void, close: () => void }

type Session_Handlers = { output: (chunk: string) => void, exit: (code: number, reason?: string) => void, decoder: TextDecoder }

type Pending = { resolve: (info: Host_Info) => void, reject: (error: Error) => void, timer: number }

const channel = "jazu-host"
// the extension answers "hello" at once; without an answer it is not installed (or the page's origin is not allowed)
const hello_timeout_ms = 2500
const sessions = new Map<number, Session_Handlers>()
let next_session = 1
let listening = false
let pending: Pending | null = null
let connection: Promise<Host_Info> | null = null

function post(message: Record<string, unknown>): void {
    window.postMessage({ channel, direction: "to_host", message }, location.origin)
}

function to_base64(bytes: Uint8Array): string {
    let binary = ""
    for (let start = 0; start < bytes.length; start += 0x8000) binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000))
    return btoa(binary)
}

function from_base64(data: string): Uint8Array {
    return Uint8Array.from(atob(data), char => char.charCodeAt(0))
}

function lose(error: Error): void {
    if (pending) { clearTimeout(pending.timer); pending.reject(error) }
    pending = null
    connection = null
    terminal_hooks.uri = "pid:"
    for (const [id, session] of [...sessions]) { sessions.delete(id); session.exit(1, error.message) }
}

function on_ready(info: Host_Info): void {
    if (!pending) return
    clearTimeout(pending.timer)
    pending.resolve(info)
    pending = null
    terminal_hooks.uri = "host:"
}

function handle(message: Record<string, unknown>): void {
    const id = typeof message.id === "number" ? message.id : 0
    switch (message.type) {
        case "hello":
            // the extension is there; the host process still has to start
            if (pending) { clearTimeout(pending.timer); pending.timer = window.setTimeout(() => lose(new Error(text("host_missing"))), Number(message.timeout_ms) || 8000) }
            return
        case "host_ready": return on_ready(message as unknown as Host_Info)
        case "host_error": return lose(new Error(String(message.message ?? text("host_missing"))))
        case "host_closed": return lose(new Error(text("host_missing")))
        case "output": return void sessions.get(id)?.output(sessions.get(id)!.decoder.decode(from_base64(String(message.data ?? "")), { stream: true }))
        case "exit": { const session = sessions.get(id); sessions.delete(id); return session?.exit(Number(message.code ?? 0)) }
        case "error": { const session = sessions.get(id); if (session) { sessions.delete(id); session.exit(1, String(message.message)) } }
    }
}

function listen(): void {
    if (listening) return
    listening = true
    window.addEventListener("message", event => {
        // only the extension's content script, in this very window and origin, may speak for the host
        if (event.source !== window || event.origin !== location.origin) return
        const data = event.data
        if (!data || data.channel !== channel || data.direction !== "to_page" || !data.message || typeof data.message !== "object") return
        handle(data.message as Record<string, unknown>)
    })
}

export function connect_host(): Promise<Host_Info> {
    if (connection) return connection
    listen()
    connection = new Promise<Host_Info>((resolve, reject) => {
        pending = { resolve, reject, timer: window.setTimeout(() => lose(new Error(text("host_missing"))), hello_timeout_ms) }
        post({ type: "hello" })
    })
    // a probe nobody awaits must not raise "unhandled rejection"
    connection.catch(() => undefined)
    return connection
}

export function probe_host(): void {
    if (document.querySelector(".desk[data-runtime]")) void connect_host()
}

export function open_session(cols: number, rows: number, output: (chunk: string) => void, exit: (code: number, reason?: string) => void): Host_Session {
    const id = next_session++
    const encoder = new TextEncoder()
    sessions.set(id, { output, exit, decoder: new TextDecoder() })
    post({ type: "open", id, cols, rows })
    return {
        write: data => { if (sessions.has(id)) post({ type: "input", id, data: to_base64(encoder.encode(data)) }) },
        resize: (next_cols, next_rows) => { if (sessions.has(id)) post({ type: "resize", id, cols: next_cols, rows: next_rows }) },
        close: () => { if (sessions.delete(id)) post({ type: "close", id }) },
    }
}

async function pump_input(api: proc_api, session: () => Host_Session | null): Promise<void> {
    while (!api.signal.aborted) {
        const chunk = await api.stdin.read()
        if (chunk === null) { if (api.stdin.ended) return; continue }
        session()?.write(chunk)
    }
}

async function host_sh(api: proc_api): Promise<number> {
    let size: [number, number] = [80, 24]
    let session: Host_Session | null = null
    // the terminal reports its real size as soon as it is on screen; the shell must be opened at that size, not at a default
    api.resize = (cols, rows) => { size = [cols, rows]; session?.resize(cols, rows) }
    try {
        await connect_host()
    } catch (error) {
        api.stderr.write(`${(error as Error).message}\r\n`)
        return 1
    }
    return new Promise<number>(done => {
        session = open_session(size[0], size[1], chunk => api.stdout.write(chunk), (code, reason) => {
            if (reason) api.stderr.write(`\r\n${reason}\r\n`)
            done(code)
        })
        // Ctrl+C is data for a real terminal: the device's line discipline turns it into SIGINT for the foreground job
        api.on_interrupt(() => session?.write("\x03"))
        api.signal.addEventListener("abort", () => session?.close())
        void pump_input(api, () => session)
    })
}

export const host_programs: Record<string, program> = { host_sh }
