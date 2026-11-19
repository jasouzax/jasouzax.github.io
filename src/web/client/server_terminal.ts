/*
 * The Pi's terminal inside the desk: a kernel program that only relays bytes between a terminal window and a pty of the Pi.
 *
 * Entities
 *   server_programs   { server_sh }: registered with the kernel next to the WASM programs and the device-bridge shell
 *   init_server_terminal  makes "Open terminal" start the Pi's shell while the owner's link is up
 * Scope
 *   Same streams as host_sh (desk_host.ts): the window sends keystrokes, the Pi's line discipline turns Ctrl+C into SIGINT.
 */
import type { proc_api, program } from "./proc_types.ts"
import { terminal_hooks } from "./desk_view.ts"
import { owner_link, on_owner_link } from "./desk_server_owner.ts"
import { open_pty_session, type Pty_Session } from "./server_pty.ts"

export const server_shell_uri = "server:sh"

async function pump_input(api: proc_api, session: () => Pty_Session | null): Promise<void> {
    while (!api.signal.aborted) {
        const chunk = await api.stdin.read()
        if (chunk === null) { if (api.stdin.ended) return; continue }
        session()?.write(chunk)
    }
}

async function server_sh(api: proc_api): Promise<number> {
    const link = owner_link()
    if (!link) { api.stderr.write("The server is offline.\r\n"); return 1 }
    let size: [number, number] = [80, 24]
    let session: Pty_Session | null = null
    // the terminal reports its real size once it is on screen; the shell opens at that size
    api.resize = (cols, rows) => { size = [cols, rows]; session?.resize(cols, rows) }
    return new Promise<number>(done => {
        session = open_pty_session(link, size[0], size[1], chunk => api.stdout.write(chunk), (code, reason) => {
            if (reason) api.stderr.write(`\r\n${reason}\r\n`)
            done(code)
        })
        api.on_interrupt(() => session?.write("\x03"))
        api.signal.addEventListener("abort", () => session?.close())
        void pump_input(api, () => session)
    })
}

export const server_programs: Record<string, program> = { server_sh }

export function init_server_terminal(): void {
    let before = ""
    on_owner_link(link => {
        if (link) { before = terminal_hooks.uri === server_shell_uri ? before : terminal_hooks.uri; terminal_hooks.uri = server_shell_uri }
        else if (terminal_hooks.uri === server_shell_uri) terminal_hooks.uri = before || "pid:"
    })
}
