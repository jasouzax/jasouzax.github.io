/* Durable cache of origin-generated public markup and JSON; changed structure is fetched only by revision. */
import { sign_origin } from "../../shared/sign.ts"
import { fill_status, status_data, type Status_Data, type Status_Template, type Rendered_Status } from "../../shared/render/status.ts"

export type Render_Env = { PERSONAL_ORIGIN?: string; ORIGIN_HMAC_SECRET?: string; ACCESS_CLIENT_ID?: string; ACCESS_CLIENT_SECRET?: string }
type Store = { get<T>(key: string): Promise<T | undefined>; put(key: string, value: unknown): Promise<void> }
type Cached = Status_Template & { data: Status_Data; checked_at: number }
type Fetcher = (request: Request) => Promise<Response>

export class Public_Renderer {
    #pending: Promise<Rendered_Status | null> | null = null
    constructor(private storage: Store, private env: Render_Env, private upstream: Fetcher = fetch, private now: () => number = Date.now) {}

    render(): Promise<Rendered_Status | null> {
        return this.#pending ??= this.#render().finally(() => { this.#pending = null })
    }

    async #read(path: string): Promise<unknown> {
        if (!this.env.PERSONAL_ORIGIN || !this.env.ORIGIN_HMAC_SECRET) throw new Error("Public rendering is not configured")
        const origin = new URL(this.env.PERSONAL_ORIGIN)
        if (origin.origin !== this.env.PERSONAL_ORIGIN || (origin.protocol !== "https:" && !["127.0.0.1", "localhost"].includes(origin.hostname))) throw new Error("Invalid personal origin")
        const request = new Request(new URL(path, origin), { signal: AbortSignal.timeout(12000), redirect: "manual" })
        const headers = await sign_origin(request, this.env.ORIGIN_HMAC_SECRET, "public-render")
        if (this.env.ACCESS_CLIENT_ID) headers.set("CF-Access-Client-Id", this.env.ACCESS_CLIENT_ID)
        if (this.env.ACCESS_CLIENT_SECRET) headers.set("CF-Access-Client-Secret", this.env.ACCESS_CLIENT_SECRET)
        const upstream = this.upstream
        const response = await upstream(new Request(request, { headers }))
        if (!response.ok) throw new Error("Public origin unavailable")
        const text = await response.text()
        if (text.length > 65536) throw new Error("Public render response too large")
        return JSON.parse(text)
    }

    async #render(): Promise<Rendered_Status | null> {
        let cached = await this.storage.get<Cached>("public-render:server")
        if (cached && this.now() - cached.checked_at < 60000) return fill_status(cached.html, cached.data, this.now() - cached.data.taken_at > 120000)
        if (this.now() < (await this.storage.get<number>("public-render:server:retry") ?? 0)) return cached ? fill_status(cached.html, cached.data, true) : null
        try {
            const data = status_data(await this.#read("/render/server/data"))
            if (!data || data.taken_at > this.now() + 60000) throw new Error("Invalid public snapshot")
            let template: Status_Template
            if (cached?.revision === data.revision) template = cached
            else {
                const value = await this.#read("/render/server/template") as Status_Template
                if (!value || typeof value.html !== "string" || value.html.length > 32768 || value.revision !== data.revision) throw new Error("Invalid public template")
                const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value.html)))].map(byte => byte.toString(16).padStart(2, "0")).join("")
                if (hash !== data.revision) throw new Error("Public template revision mismatch")
                template = value
            }
            const next: Cached = { revision: data.revision, html: template.html, data, checked_at: this.now() }
            // Template and data are one record so a failed refresh never pairs different revisions.
            await this.storage.put("public-render:server", next)
            cached = next
            return fill_status(cached.html, cached.data, this.now() - data.taken_at > 120000)
        } catch {
            await this.storage.put("public-render:server:retry", this.now() + 60000).catch(() => {})
            return cached ? fill_status(cached.html, cached.data, true) : null
        }
    }
}
