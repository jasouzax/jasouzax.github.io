/*
 * What the log view of an automation script keeps and shows (no DOM).
 *
 * Entities
 *   Log_Store      the log lines of every script the page has heard of, newest last, at most max_log_entries each
 *   log_stamp      "2026-11-19 14:03:09" in the viewer's time zone
 *   count_label    "1 message" / "12 messages" from the string template of the language
 * Scope
 *   The agent keeps the real history (1000 lines per script) and replays it when a view opens; this store only mirrors it for the open views.
 */
import type { Log_Entry } from "../../../shared/protocol/wire.ts"

export const max_log_entries = 1000

export class Log_Store {
    readonly #entries = new Map<string, Log_Entry[]>()

    set(path: string, entries: Log_Entry[]): void { this.#entries.set(path, entries.slice(-max_log_entries)) }

    add(path: string, entry: Log_Entry): void {
        const list = this.#entries.get(path) ?? []
        // a replayed history and a live line can overlap by one: the id says it is the same line
        if (list.length && list[list.length - 1].id >= entry.id && list.some(known => known.id === entry.id)) return
        list.push(entry)
        if (list.length > max_log_entries) list.shift()
        this.#entries.set(path, list)
    }

    clear(path: string): void { this.#entries.delete(path) }

    get(path: string, errors_only = false): Log_Entry[] {
        const list = this.#entries.get(path) ?? []
        return errors_only ? list.filter(entry => entry.level === "error") : list
    }

    count(path: string): number { return this.#entries.get(path)?.length ?? 0 }
    has_error(path: string): boolean { return (this.#entries.get(path) ?? []).some(entry => entry.level === "error") }
}

export function log_stamp(time: number, zone_offset_minutes = -new Date(time).getTimezoneOffset()): string {
    const shifted = new Date(time + zone_offset_minutes * 60_000)
    return shifted.toISOString().slice(0, 19).replace("T", " ")
}

export function count_label(count: number, one: string, many: string): string {
    return (count === 1 ? one : many).replace("{n}", String(count))
}
