/*
 * The /server desk, public side: the one-minute fastfetch snapshot of the personal server in a text window, or "offline".
 *
 * Entities
 *   server            { mode, status }: what the page knows about the server; mode is "unknown" until the first answer
 *   load_status       GET /api/_/server through one shared request; the answer is reused for a minute (the Worker caches it for a minute too)
 *   snapshot_text     the text shown in the fastfetch window for a status (pure)
 *   init_server       registers the `server:fastfetch` source, refreshes its windows once a minute while the tab is visible
 * Scope
 *   Everybody gets the same view; the owner's live view (real file system, terminal, scripts, sites) is built on top by desk_server_owner.ts
 *   once `server.mode` becomes "owner". Nothing here writes to the shared virtual file system.
 * Limits
 *   Free tier: one request a minute per open tab, answered by the edge cache; a hidden tab does not poll.
 */
import type { desk_window } from "../index.ts"
import { state, text } from "../index.ts"
import { load_file, open_source, uri_handlers } from "../window/index.ts"
import { fetch_public_status } from "./link.ts"
import { init_site_sources } from "./site.ts"
import { mode_of, snapshot_text, type Server_Mode } from "./text.ts"
export { mode_of, snapshot_text, type Server_Mode }
import type { Public_Status } from "../../shared/protocol/wire.ts"

export const server: { mode: Server_Mode, status: Public_Status | null, failed: boolean, live_refresh: (() => void) | null } = { mode: "unknown", status: null, failed: false, live_refresh: null }

export const fastfetch_uri = "server:fastfetch"
export const status_ttl_ms = 60_000

const mode_listeners = new Set<(mode: Server_Mode) => void>()
let inflight: Promise<Public_Status | null> | null = null
let loaded_at = 0
let timer: number | null = null
export function stop_server_timer(): void { if (timer !== null) { clearInterval(timer); timer = null } }

export function on_server_mode(listener: (mode: Server_Mode) => void): () => void {
    mode_listeners.add(listener)
    return () => { mode_listeners.delete(listener) }
}

function set_status(status: Public_Status | null): void {
    server.failed = status === null
    if (!status) return
    server.status = status
    const mode = mode_of(status)
    if (mode === server.mode) return
    server.mode = mode
    for (const listener of [...mode_listeners]) listener(mode)
}

export function load_status(force = false, now = Date.now()): Promise<Public_Status | null> {
    if (inflight) return inflight
    if (!force && server.status && now - loaded_at < status_ttl_ms) return Promise.resolve(server.status)
    inflight = fetch_public_status().then(status => { loaded_at = Date.now(); set_status(status); return status }, () => { set_status(null); return null }).finally(() => { inflight = null })
    return inflight
}

async function open_fastfetch(item: desk_window, current: () => boolean): Promise<void> {
    const status = await load_status()
    if (!current()) return
    const body = snapshot_text(status, server.failed, text)
    await load_file(item, new Blob([body], { type: "text/plain" }), "fastfetch.txt", fastfetch_uri, current)
    // a snapshot is read-only: the window shows it, nothing is saved anywhere
    if (current()) { item.mode = "view"; item.save = null }
}

function fastfetch_windows(): desk_window[] {
    return state.windows.filter(item => item.el.isConnected && item.path === fastfetch_uri)
}

// The owner's live link brings a fresh snapshot: it replaces the public one and the windows show it at once
export function note_snapshot(snapshot_text_value: string, taken_at: number): void {
    if (!server.status) return
    server.status = { ...server.status, snapshot: { text: snapshot_text_value, taken_at } }
    loaded_at = Date.now()
    for (const item of fastfetch_windows()) if (!item.dirty) void open_source(item, fastfetch_uri)
}

async function refresh_fastfetch(): Promise<void> {
    if (document.hidden || fastfetch_windows().length === 0) return
    // the owner's link asks the Pi itself (the answer arrives as a snapshot); everybody else polls the cached public status
    if (server.live_refresh) { server.live_refresh(); return }
    const before = server.status?.snapshot?.taken_at
    const status = await load_status(true)
    if (status?.snapshot?.taken_at === before && server.mode !== "offline") return
    for (const item of fastfetch_windows()) if (!item.dirty) void open_source(item, fastfetch_uri)
}

export function init_server(): void {
    init_site_sources()
    if (uri_handlers.some(handler => (handler as { server?: boolean }).server)) return
    const handler = async (item: desk_window, uri: string, current: () => boolean = () => true): Promise<boolean> => {
        if (uri.trim() !== fastfetch_uri) return false
        await open_fastfetch(item, current)
        return true
    }
    ;(handler as { server?: boolean }).server = true
    uri_handlers.push(handler)
    // one global tick: it does nothing without a visible tab and a fastfetch window
    timer = window.setInterval(() => { void refresh_fastfetch() }, status_ttl_ms)
}
