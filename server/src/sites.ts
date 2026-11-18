/*
 * Standalone site windows: the browser windows of `application/auto-site` files, which belong to no script.
 *
 * Entities
 *   Site_Registry   opens and closes one window per key, and hands each to the window registry as the script "site:<key>"
 *   Site_Web        the few members of a Web window the registry needs (the Electron class in production, a fake in tests)
 *
 * Responsibilities
 *   A key is chosen by the page (one per file), so opening it again after a reconnect finds the window instead of making a second one.
 *   A window that closes by itself (its tab was closed in the page) leaves the registry, so the key can be opened again.
 * Limits
 *   Only http(s) addresses and about:blank open: a site window is for sites, not for the Pi's files.
 *   At most max_sites at once; a window costs real memory on a Pi.
 */
export const max_sites = 8
export const site_key_pattern = /^[A-Za-z0-9._-]{1,128}$/
export const site_script_prefix = "site:"

export interface Site_Web {
    url: string
    once(event: "close", handler: () => void): unknown
    close(): Promise<unknown>
}
export type Make_Web = (url: string) => Site_Web
export interface Site_Host { track(script: string, web: Site_Web): void }
export type Site_Options = { make_web: Make_Web, windows: Site_Host, max?: number }

export function site_script(key: string): string {
    return site_script_prefix + key
}

export function is_site_url(url: unknown): url is string {
    if (typeof url !== "string" || url.length > 4096) return false
    if (url === "about:blank") return true
    try { return ["http:", "https:"].includes(new URL(url).protocol) } catch { return false }
}

export class Site_Registry {
    readonly #options: Site_Options
    readonly #webs = new Map<string, Site_Web>()

    constructor(options: Site_Options) {
        this.#options = options
    }

    get count(): number {
        return this.#webs.size
    }

    // True when the key has a window afterwards (new or already there)
    open(key: unknown, url: unknown): boolean {
        if (typeof key !== "string" || !site_key_pattern.test(key) || !is_site_url(url)) return false
        if (this.#webs.has(key)) return true
        if (this.#webs.size >= (this.#options.max ?? max_sites)) return false
        const web = this.#options.make_web(url)
        this.#webs.set(key, web)
        web.once("close", () => { if (this.#webs.get(key) === web) this.#webs.delete(key) })
        this.#options.windows.track(site_script(key), web)
        return true
    }

    async close(key: unknown): Promise<void> {
        if (typeof key !== "string") return
        const web = this.#webs.get(key)
        this.#webs.delete(key)
        await web?.close()
    }

    async close_all(): Promise<void> {
        await Promise.all([...this.#webs.keys()].map(key => this.close(key)))
    }
}
