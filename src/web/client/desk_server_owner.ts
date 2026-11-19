/*
 * The /server desk for the signed-in owner: the Pi's real file system replaces the desk's root while the agent is online.
 *
 * Entities
 *   owner_link      the open Server_Link while the owner's desk is shown (null otherwise); terminals, scripts and site windows use it
 *   on_owner_link   subscribe to the link appearing and disappearing
 *   init_server_owner  starts and stops the owner mode as pages come and go
 * Scope
 *   Only on /server (and /ja/server) and only when GET /api/server says owner + online. Leaving the page closes the socket and puts the
 *   shared virtual file system back exactly as it was; the Pi is never reachable from any other page.
 * Limits
 *   One socket per tab. While the agent is away the root keeps the Pi's tree and operations fail with a readable error until it returns.
 */
import { filesystem_initialized, swap_root, load_children, fs_root, redraw, remote_root_active } from "./desk_fs.ts"
import type { dir_handle } from "./desk_fs.ts"
import { load_status, note_snapshot, server } from "./desk_server.ts"
import { is_server_page } from "./server_text.ts"
import { Server_Link, default_socket_url } from "./server_link.ts"
import { remote_directory } from "./server_fs.ts"

let link: Server_Link | null = null
let restore: (() => Promise<void>) | null = null
let starting = false
const listeners = new Set<(link: Server_Link | null) => void>()

export function owner_link(): Server_Link | null { return link }

export function on_owner_link(listener: (link: Server_Link | null) => void): () => void {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
}

function announce(): void { for (const listener of [...listeners]) listener(link) }

async function on_link_state(current: Server_Link): Promise<void> {
    if (current !== link || !current.connected || !current.online) return
    if (!restore) {
        restore = await swap_root(remote_directory(current, "/") as dir_handle, true).catch(() => null)
        if (current !== link) { await restore?.(); restore = null; return }
        current.send({ t: "fastfetch" })
        announce()
        return
    }
    // the agent came back: list the root again
    const root = fs_root()
    if (root && remote_root_active()) { await load_children(root); redraw() }
}

async function start_owner(): Promise<void> {
    if (link || starting) return
    starting = true
    try {
        await filesystem_initialized()
        const current = new Server_Link({ url: default_socket_url() })
        link = current
        server.live_refresh = () => { current.send({ t: "fastfetch" }) }
        current.on("fastfetch", message => note_snapshot(String(message.text ?? ""), Number(message.taken_at) || Date.now()))
        current.on_state(() => { void on_link_state(current) })
        current.open()
    } finally { starting = false }
}

export async function stop_owner(): Promise<void> {
    const current = link
    link = null
    server.live_refresh = null
    current?.close()
    const undo = restore
    restore = null
    await undo?.()
    if (current) announce()
}

async function sync_owner(): Promise<void> {
    if (!is_server_page(location.pathname) || !document.querySelector(".desk[data-runtime]")) { await stop_owner(); return }
    await load_status()
    if (server.mode === "owner") await start_owner()
    else await stop_owner()
}

export function init_server_owner(): void {
    document.addEventListener("jazu:fs:init", () => { void sync_owner() })
    document.addEventListener("jazu:page", () => { if (!document.querySelector(".desk[data-runtime]")) void stop_owner() })
    window.addEventListener("pagehide", () => { link?.close() })
}
