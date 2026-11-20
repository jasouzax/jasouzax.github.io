/*
 * The Chromium windows of the Pi as the page knows them, and the rules that name a site (no DOM).
 *
 * Entities
 *   Window_Store   id -> Window_Info, kept in step with the agent's windows / window_added / window_updated / window_removed messages
 *   site_key       the stable key of a URL ("u-" + hash): the agent only accepts [A-Za-z0-9._-]{1,128}, and one URL is one shared window
 *   site_url_of    the first http(s) URL in the text of an application/auto-site file
 *   window_uri / window_id_of   `server:window:<id>`, the source of a desk window that shows a script's window
 */
import type { Window_Info } from "../../../server/src/shared/protocol.ts"

export const window_uri_prefix = "server:window:"

export function window_uri(id: number): string { return `${window_uri_prefix}${id}` }

export function window_id_of(uri: string): number | null {
    const trimmed = uri.trim()
    if (!trimmed.startsWith(window_uri_prefix)) return null
    const digits = trimmed.slice(window_uri_prefix.length)
    return /^\d{1,9}$/.test(digits) ? Number(digits) : null
}

// 53-bit string hash (cyrb53): stable across sessions and tabs, so every window that shows the same URL meets the same agent window
export function site_key(url: string): string {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57
    for (let index = 0; index < url.length; index++) {
        const code = url.charCodeAt(index)
        h1 = Math.imul(h1 ^ code, 2654435761)
        h2 = Math.imul(h2 ^ code, 1597334677)
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
    return `u-${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16)}`
}

export function is_site_url(value: string): boolean {
    try { const url = new URL(value); return url.protocol === "http:" || url.protocol === "https:" } catch { return false }
}

export function site_url_of(content: string): string | null {
    for (const raw of content.split(/\r?\n/)) {
        const line = raw.trim()
        if (!line || line.startsWith("#")) continue
        return is_site_url(line) ? line : null
    }
    return null
}

export class Window_Store {
    readonly #windows = new Map<number, Window_Info>()
    readonly #listeners = new Set<() => void>()

    on_change(listener: () => void): () => void { this.#listeners.add(listener); return () => { this.#listeners.delete(listener) } }

    apply(message: { t: string, [key: string]: unknown }): void {
        switch (message.t) {
            case "windows": this.#windows.clear(); for (const window of message.windows as Window_Info[]) this.#windows.set(window.id, window); break
            case "window_added": case "window_updated": { const window = message.window as Window_Info; this.#windows.set(window.id, window); break }
            case "window_removed": if (!this.#windows.delete(Number(message.id))) return; break
            default: return
        }
        for (const listener of [...this.#listeners]) listener()
    }

    clear(): void { if (this.#windows.size === 0) return; this.#windows.clear(); for (const listener of [...this.#listeners]) listener() }
    get(id: number): Window_Info | undefined { return this.#windows.get(id) }
    // The window or the DevTools picture with this id (DevTools are numbered like windows, with the size of their own picture)
    picture(id: number): { id: number, width: number, height: number, owner: Window_Info } | undefined {
        const direct = this.#windows.get(id)
        if (direct) return { id, width: direct.width, height: direct.height, owner: direct }
        for (const window of this.#windows.values()) if (window.devtools?.id === id) return { id, width: window.devtools.width, height: window.devtools.height, owner: window }
        return undefined
    }
    of_site(key: string): Window_Info | undefined { return [...this.#windows.values()].find(window => window.script === `site:${key}`) }
    of_script(path: string): Window_Info[] { return [...this.#windows.values()].filter(window => window.script === path) }
    all(): Window_Info[] { return [...this.#windows.values()] }
}
