/*
 * Wire contract between the Pi agent (server/), the Server_Hub Durable Object (src/node/server_hub.ts) and the page (src/web/client/server_*.ts).
 * Types and constants only: no imports, no I/O, erasable TypeScript, so Node, the Worker bundler, esbuild and tsc can all read this file.
 *
 * Entities
 *   Client_Message   page -> hub -> agent; the hub adds `peer` (the page's socket id) before relaying
 *   Agent_Message    agent -> hub -> page; `to` is a peer id, no `to` means every connected page
 *   Hub_To_Agent     what only the hub says to the agent (viewer count, gateway requests, snapshot requests)
 *   Agent_To_Hub     what only the hub hears from the agent (hello, endpoint map, gateway and snapshot answers)
 *   Hub_To_Client    what only the hub says to a page (its id, whether the agent is online)
 *   *_types          the closed sets of `t` values each side accepts; anything else is dropped, never relayed
 *
 * Limits
 *   A text frame stays below max_frame_bytes (Cloudflare closes sockets on messages over 1 MiB), so bulk data is chunked.
 *   Binary frames carry pictures and sound only: [kind u8][window id u32 BE][payload].
 */

export const protocol_version = 1
// The `client` the agent signs its upgrade request with (HMAC, see src/node/security.ts sign_origin)
export const agent_client_id = "server-agent"
// Text heartbeat: the Durable Object answers it with setWebSocketAutoResponse, so it never wakes the object
export const heartbeat_ping = "ping"
export const heartbeat_pong = "pong"
export const max_frame_bytes = 900 * 1024
export const fs_chunk_bytes = 384 * 1024
// Bodies travel as base64 inside one JSON frame: 600 KiB raw is 800 KiB of text, which stays under max_frame_bytes with room for the headers
export const api_body_limit = 600 * 1024
export const binary_video = 1
export const binary_audio = 2
export const video_header_size = 5
export const audio_header_size = 13
// Names a script may not publish: the site's own routes and files
export const reserved_api_names = ["api", "css", "js", "ws", "v1", "server"] as const
export const api_name_pattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

// ---- filesystem ----------------------------------------------------------------------------------------------------------------------

export type Fs_Kind = "file" | "dir" | "other"
export type Fs_Stat = { kind: Fs_Kind, size: number, mtime: number, mode: number, writable: boolean }
export type Fs_Entry = { name: string, kind: Fs_Kind, size: number, mtime: number }
export type Fs_Request =
    | { op: "stat", path: string }
    | { op: "list", path: string }
    | { op: "read", path: string, offset: number, length: number }
    // `truncate` is set on the first chunk of an upload; later chunks continue at `offset`
    | { op: "write", path: string, offset: number, data: string, truncate?: boolean }
    | { op: "mkdir", path: string }
    | { op: "remove", path: string, recursive?: boolean }
    | { op: "rename", path: string, to: string }
    | { op: "copy", path: string, to: string }
export type Fs_Op = Fs_Request["op"]
export type Fs_Result =
    | { op: "stat", stat: Fs_Stat }
    | { op: "list", entries: Fs_Entry[] }
    | { op: "read", data: string, size: number, eof: boolean }
    | { op: "write", size: number }
    | { op: "mkdir" | "remove" | "rename" | "copy" }
// Errno-like codes the page maps onto File System Access errors
export type Fs_Code = "ENOENT" | "EEXIST" | "ENOTDIR" | "EISDIR" | "ENOTEMPTY" | "EACCES" | "EROFS" | "EINVAL" | "EFBIG" | "EIO"

// ---- scripts -------------------------------------------------------------------------------------------------------------------------

export type Log_Level = "log" | "info" | "debug" | "warn" | "error" | "system"
export type Log_Entry = { id: number, time: number, level: Log_Level, text: string }
export type Script_Info = { path: string, running: boolean, windows: number }

// ---- windows (the live feed) -----------------------------------------------------------------------------------------------------------

// One window of a running script, or of a standalone site (`script` is then "site:" + key); the feed is a picture of exactly width x height
export type Window_Info = {
    id: number
    script: string
    title: string
    url: string
    // A data: or http(s) URL of the page icon, "" when the page has none
    icon: string
    width: number
    height: number
    can_back?: boolean
    can_forward?: boolean
    // Chromium's DevTools of this window when open: a picture of their own, numbered like a window
    devtools: { id: number, width: number, height: number } | null
}
export type Clipboard_Data = { text: string, html?: string }
export type Selector_Candidate = { selector: string, confidence: number, signals: string[] }
export type Mouse_Kind = "move" | "down" | "up" | "wheel"
// Coordinates are in the page's own CSS pixels, so any screen size maps onto the same spot
export type Input_Event =
    | { kind: "mouse", action: Mouse_Kind, x: number, y: number, button?: "left" | "middle" | "right", clicks?: number, dx?: number, dy?: number, modifiers?: string[] }
    | { kind: "key", action: "down" | "up", key: string, modifiers?: string[] }
    | { kind: "text", text: string }

// ---- page -> agent ----------------------------------------------------------------------------------------------------------------------

export type Client_Message =
    | ({ t: "fs", id: number } & Fs_Request)
    | { t: "pty_open", id: number, cols: number, rows: number, cwd?: string }
    // `data` of pty_input and pty_out is base64 of the raw bytes: a shell may emit or accept any byte sequence
    | { t: "pty_input", id: number, data: string }
    | { t: "pty_resize", id: number, cols: number, rows: number }
    | { t: "pty_close", id: number }
    | { t: "auto_start", path: string }
    | { t: "auto_stop", path: string }
    | { t: "auto_delete", path: string }
    | { t: "auto_state" }
    | { t: "auto_logs", path: string }
    | { t: "auto_clear_logs", path: string }
    | { t: "fastfetch" }
    | { t: "site_open", key: string, url: string }
    | { t: "site_close", key: string }
    // Which window the page looks at: only that one is streamed, null stops it. `audio` asks for sound too
    | { t: "feed_watch", id: number | null, max_width: number, audio?: boolean }
    | { t: "window_input", id: number, input: Input_Event }
    | { t: "window_navigate", id: number, url?: string, delta?: -1 | 0 | 1 }
    | { t: "window_close", id: number }
    | { t: "window_create", script: string }
    | { t: "window_devtools", id: number, open: boolean }
    // size: null puts the window back to 800x600
    | { t: "window_resize", id: number, size: { width: number, height: number } | null }
    | { t: "clipboard_copy", id: number, cut?: boolean }
    | { t: "clipboard_paste", id: number, data: Clipboard_Data }

// What the hub adds when it relays a page's message
export type Relayed<Message> = Message & { peer: string }

// ---- agent -> page ----------------------------------------------------------------------------------------------------------------------

export type Agent_Message =
    | { t: "fs_ok", id: number, result: Fs_Result }
    | { t: "fs_err", id: number, code: Fs_Code, message: string }
    | { t: "pty_out", id: number, data: string }
    | { t: "pty_exit", id: number, code: number }
    | { t: "pty_err", id: number, message: string }
    | { t: "auto_state", scripts: Script_Info[] }
    | { t: "auto_logs", path: string, entries: Log_Entry[] }
    | { t: "auto_log", path: string, entry: Log_Entry }
    | { t: "auto_status", path: string, running: boolean }
    | { t: "auto_deleted", path: string }
    | { t: "auto_logs_cleared", path: string }
    | { t: "auto_error", path: string, message: string }
    | { t: "fastfetch", text: string, taken_at: number }
    | { t: "windows", windows: Window_Info[] }
    | { t: "window_added", window: Window_Info }
    | { t: "window_updated", window: Window_Info }
    | { t: "window_removed", id: number }
    // `seq` grows with every pointer position of a window; a page ignores a hover that is not newer than the last it applied
    | { t: "window_hover", id: number, seq: number, selector: string, candidates: Selector_Candidate[] }
    | { t: "clipboard", data: Clipboard_Data }
export type Routed<Message> = Message & { to?: string }

// ---- hub <-> agent / hub -> page -----------------------------------------------------------------------------------------------------------

export type Api_Info = { name: string, public: boolean }
export type Api_Call = { id: number, name: string, method: string, path: string, query: Record<string, string | string[]>, headers: Record<string, string>, body: string, ip: string }
export type Api_Answer = { id: number, status: number, headers: Record<string, string>, body: string }

export type Hub_To_Agent =
    // How many pages are connected: the agent sends nothing while this is 0 (free-tier budget)
    | { t: "viewers", count: number }
    | { t: "peer_gone", peer: string }
    | ({ t: "api_req" } & Api_Call)
    | { t: "fastfetch_req", id: number }

export type Agent_To_Hub =
    | { t: "agent_hello", version: number, app: string, platform: string }
    | { t: "api_set", apis: Api_Info[] }
    | ({ t: "api_res" } & Api_Answer)
    | { t: "fastfetch_res", id: number, text: string, taken_at: number }

export type Hub_To_Client =
    | { t: "welcome", peer: string, online: boolean }
    | { t: "status", online: boolean }

// What GET /api/server answers to everybody (the snapshot is never older than a minute unless the agent is offline)
export type Public_Status = { online: boolean, owner: boolean, snapshot: { text: string, taken_at: number } | null, stale: boolean }

// ---- accepted `t` values ------------------------------------------------------------------------------------------------------------------

export const client_message_types: ReadonlySet<string> = new Set([
    "fs", "pty_open", "pty_input", "pty_resize", "pty_close", "auto_start", "auto_stop", "auto_delete", "auto_state", "auto_logs", "auto_clear_logs", "fastfetch",
    "site_open", "site_close", "feed_watch", "window_input", "window_navigate", "window_close", "window_create", "window_devtools", "window_resize",
    "clipboard_copy", "clipboard_paste",
])
// What the hub forwards from the agent to pages
export const agent_message_types: ReadonlySet<string> = new Set([
    "fs_ok", "fs_err", "pty_out", "pty_exit", "pty_err", "auto_state", "auto_logs", "auto_log", "auto_status", "auto_deleted", "auto_logs_cleared", "auto_error",
    "fastfetch", "windows", "window_added", "window_updated", "window_removed", "window_hover", "clipboard",
])
// What the hub consumes from the agent itself
export const agent_direct_types: ReadonlySet<string> = new Set(["agent_hello", "api_set", "api_res", "fastfetch_res"])

// Parses a text frame into a plain object whose `t` is in `allowed`; null for anything else (never throws)
export function parse_message(frame: string, allowed: ReadonlySet<string>): { t: string, [key: string]: unknown } | null {
    if (frame.length > max_frame_bytes) return null
    let value: unknown
    try { value = JSON.parse(frame) } catch { return null }
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null
    const t = (value as { t?: unknown }).t
    return typeof t === "string" && allowed.has(t) ? value as { t: string, [key: string]: unknown } : null
}
