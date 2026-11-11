/*
 * JAZU native messaging host: the process Chrome starts for the extension (one per open desk page).
 * Entities:
 *   main loop - reads framed requests from stdin, runs them, writes framed replies to stdout
 *   sessions  - open id -> real shell on a pty; at most max_sessions at once
 * Scope:
 *   Runs with the permissions of the browser's user, which is the point: the desk gets that user's shell. Nothing else.
 *   Never listens on a network port; Chrome only starts it for the extension id named in its native messaging manifest.
 *   When stdin ends (page closed, browser gone) every shell is hung up and the process exits.
 *   Reply types: host_ready, opened, output, exit, error. Never write to stdout except through send() (stdout is the protocol).
 */
import { hostname, userInfo } from "node:os"
import { statSync } from "node:fs"
import { Frame_Reader, encode_frame } from "./frame.ts"
import { parse_request, Protocol_Error } from "./protocol.ts"
import type { Host_Request } from "./protocol.ts"
import { open_pty, pick_backend } from "./pty.ts"
import type { Pty_Backend, Pty_Session } from "./pty.ts"

const version = "0.1.0"
const max_sessions = 16
// base64 grows data by a third and a reply must stay under 1 MiB
const output_slice = 48 * 1024

const sessions = new Map<number, Pty_Session>()
let throttled = false

function send(message: Record<string, unknown>): void {
    const accepted = process.stdout.write(encode_frame(message))
    if (accepted || throttled) return
    // Chrome reads slowly: stop reading shells until the pipe drains, instead of buffering without bound
    throttled = true
    for (const session of sessions.values()) session.pause()
    process.stdout.once("drain", () => {
        throttled = false
        for (const session of sessions.values()) session.resume()
    })
}

function choose_shell(): string {
    const wanted = [process.env.JAZU_HOST_SHELL, userInfo().shell, "/bin/bash", "/bin/sh"]
    return wanted.find((path): path is string => !!path && path.startsWith("/") && is_file(path)) ?? "/bin/sh"
}

function is_file(path: string): boolean {
    try { return statSync(path).isFile() } catch { return false }
}

function shell_environment(shell: string): NodeJS.ProcessEnv {
    const account = userInfo()
    return { ...process.env, HOME: account.homedir, USER: account.username, LOGNAME: account.username, SHELL: shell, TERM: "xterm-256color", COLORTERM: "truecolor" }
}

function open_session(request: Extract<Host_Request, { type: "open" }>, backend: Pty_Backend, shell: string): void {
    if (sessions.has(request.id)) throw new Protocol_Error(`session ${request.id} already exists`)
    if (sessions.size >= max_sessions) throw new Protocol_Error(`at most ${max_sessions} shells at once`)
    const account = userInfo()
    const session = open_pty({ cols: request.cols, rows: request.rows, cwd: account.homedir, shell, env: shell_environment(shell), backend }, {
        on_data: chunk => {
            for (let start = 0; start < chunk.length; start += output_slice) send({ type: "output", id: request.id, data: chunk.subarray(start, start + output_slice).toString("base64") })
        },
        on_exit: code => {
            sessions.delete(request.id)
            send({ type: "exit", id: request.id, code })
        },
    })
    sessions.set(request.id, session)
    send({ type: "opened", id: request.id })
}

function handle(request: Host_Request, backend: Pty_Backend, shell: string): void {
    if (request.type === "open") return open_session(request, backend, shell)
    const session = sessions.get(request.id)
    // input or resize racing with a shell that just exited is normal, not an error
    if (!session) return
    if (request.type === "input") session.write(request.data)
    else if (request.type === "resize") session.resize(request.cols, request.rows)
    else session.close()
}

function shut_down(code: number): never {
    for (const session of sessions.values()) session.close()
    // give the hang-up a moment to reach the shells before the process goes
    setTimeout(() => process.exit(code), 150)
    return undefined as never
}

function main(): void {
    const backend = pick_backend()
    const shell = choose_shell()
    const account = userInfo()
    const reader = new Frame_Reader()
    send({ type: "host_ready", version, user: account.username, hostname: hostname(), home: account.homedir, shell, pty: backend })
    process.stdin.on("data", (chunk: Buffer) => {
        let messages: unknown[]
        try {
            messages = reader.push(chunk)
        } catch (error) {
            process.stderr.write(`[host] bad frame: ${(error as Error).message}\n`)
            shut_down(1)
            return
        }
        for (const message of messages) {
            try {
                handle(parse_request(message), backend, shell)
            } catch (error) {
                const id = typeof (message as { id?: unknown })?.id === "number" ? (message as { id: number }).id : undefined
                send({ type: "error", id, message: (error as Error).message })
            }
        }
    })
    process.stdin.on("end", () => shut_down(0))
    process.on("SIGTERM", () => shut_down(0))
    process.on("SIGHUP", () => shut_down(0))
}

try {
    main()
} catch (error) {
    // before the first frame there is no protocol yet: tell the extension why through a frame, then stop
    process.stdout.write(encode_frame({ type: "host_error", message: (error as Error).message }), () => process.exit(1))
}
