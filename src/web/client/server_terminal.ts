/*
 * The Pi's terminal inside the desk: a kernel program that only relays bytes between a terminal window and a pty of the Pi.
 *
 * Entities
 *   server_programs   { server_sh }: the byte relay registered by the kernel; /server does not load the WASM registry
 * Scope
 *   Same streams as host_sh (desk_host.ts): the window sends keystrokes, the Pi's line discipline turns Ctrl+C into SIGINT.
 */
import type { proc_api, program } from "./proc_types.ts"
import { owner_link } from "./desk_server_owner.ts"
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
    if (!link || !link.connected || !link.online) { api.stderr.write("The server is offline.\r\n"); return 1 }
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
