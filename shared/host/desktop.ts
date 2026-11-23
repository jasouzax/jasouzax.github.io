/* Native desktop RPC contract. The Electron main process validates every operation before OS access. */
import type { Fs_Request } from "../protocol/wire.ts"
export type Native_Rect = { x: number, y: number, width: number, height: number }
export type Native_Window = Native_Rect & { id: string, title: string, app: string }
export type Wm_Backend = "i3" | "sway" | "hyprland" | "x11"
export type Desktop_Request =
    | { op: "info" }
    | { op: "fs", request: Fs_Request }
    | { op: "clipboard_read" }
    | { op: "clipboard_write", text: string }
    | { op: "windows" }
    | { op: "place", id: string, rect: Native_Rect }
    | { op: "focus" | "window_close", id: string }
    | { op: "volume", level?: number, muted?: boolean }
    | { op: "key", key: string }
export type Desktop_Info = { platform: string, home: string, root: string, user: string, wm: Wm_Backend | null, audio: boolean, input: boolean }

export function parse_desktop_request(value: unknown): Desktop_Request {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid desktop request")
    const raw = value as Record<string, any>
    const whole = (value: unknown, min: number, max: number) => typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
    switch (raw.op) {
        case "info": case "windows": case "clipboard_read": return { op: raw.op }
        case "clipboard_write":
            if (typeof raw.text === "string" && raw.text.length <= 1024 * 1024) return { op: raw.op, text: raw.text }
            break
        case "volume":
            if ((raw.level === undefined || typeof raw.level === "number" && Number.isFinite(raw.level) && raw.level >= 0 && raw.level <= 1) && (raw.muted === undefined || typeof raw.muted === "boolean")) return { op: raw.op, level: raw.level, muted: raw.muted }
            break
        case "key":
            if (typeof raw.key === "string" && /^[A-Za-z0-9_+]{1,80}$/.test(raw.key)) return { op: raw.op, key: raw.key }
            break
        case "focus": case "window_close": case "place": {
            if (typeof raw.id !== "string" || !/^(?:[0-9]{1,16}|0x[a-fA-F0-9]{1,16})$/.test(raw.id)) break
            if (raw.op !== "place") return { op: raw.op, id: raw.id }
            const rect = raw.rect
            if (rect && whole(rect.x, -65536, 65536) && whole(rect.y, -65536, 65536) && whole(rect.width, 1, 32768) && whole(rect.height, 1, 32768)) return { op: raw.op, id: raw.id, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } }
            break
        }
        case "fs": {
            const request = raw.request
            if (!request || typeof request !== "object" || typeof request.path !== "string" || request.path.length > 4096 || request.path.includes("\0")) break
            const path = request.path
            if (["stat", "list", "mkdir"].includes(request.op)) return { op: "fs", request: { op: request.op, path } }
            if (request.op === "read" && whole(request.offset, 0, Number.MAX_SAFE_INTEGER) && whole(request.length, 0, 384 * 1024)) return { op: "fs", request: { op: "read", path, offset: request.offset, length: request.length } }
            if (request.op === "write" && whole(request.offset, 0, Number.MAX_SAFE_INTEGER) && typeof request.data === "string" && request.data.length <= 524288 && /^[A-Za-z0-9+/]*={0,2}$/.test(request.data) && (request.truncate === undefined || typeof request.truncate === "boolean")) return { op: "fs", request: { op: "write", path, offset: request.offset, data: request.data, truncate: request.truncate } }
            if (request.op === "remove" && (request.recursive === undefined || typeof request.recursive === "boolean")) return { op: "fs", request: { op: "remove", path, recursive: request.recursive } }
            if (["copy", "rename"].includes(request.op) && typeof request.to === "string" && request.to.length <= 4096 && !request.to.includes("\0")) return { op: "fs", request: { op: request.op, path, to: request.to } }
            break
        }
    }
    throw new Error("Invalid desktop operation or arguments")
}
