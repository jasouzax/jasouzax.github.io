/*
 * Pure text rules of the /server desk (no DOM): which mode a status means and what the fastfetch window says.
 */
import type { Public_Status } from "../../../shared/protocol/wire.ts"

// /server and /ja/server (a language prefix is two letters)
export function is_server_page(pathname: string): boolean {
    return /^(?:\/[a-z]{2})?\/server\/?$/.test(pathname)
}

export type Server_Mode = "unknown" | "offline" | "public" | "owner"

export function mode_of(status: Public_Status): Server_Mode {
    return status.owner && status.online ? "owner" : status.online ? "public" : "offline"
}

export function format_time(taken_at: number): string {
    return new Date(taken_at).toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC")
}

// What the fastfetch window shows: the snapshot, or the offline notice (with the last snapshot below it when there is one)
export function snapshot_text(status: Public_Status | null, failed: boolean, label: (key: string) => string): string {
    if (failed && !status) return label("server_unreachable")
    if (!status) return ""
    const snapshot = status.snapshot
    if (status.online && snapshot) return snapshot.text.replace(/\s+$/, "") + "\n"
    if (status.online) return ""
    const lines = [label("server_offline")]
    if (snapshot) lines.push("", label("server_last_snapshot").replace("{time}", format_time(snapshot.taken_at)), "", snapshot.text.replace(/\s+$/, ""))
    return lines.join("\n") + "\n"
}

