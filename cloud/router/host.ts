/* Resolve published project redirects and explicit proxy hosts from the shared ID vocabulary. */
import { valid_subdomain_id, valid_demo_host } from "../../shared/content/ids.ts"
import type { worker_env } from "./index.ts"
import { api_error } from "../security/headers.ts"
type fetcher = (request: Request) => Promise<Response>
const catalog_cache = new Map<string, { expires: number, ids: string[] }>()

export async function catalog_projects(request: Request, env: worker_env, upstream: fetcher): Promise<string[]> {
    if (!env.PUBLIC_PROJECTS_MANIFEST) return []
    const pages = new URL(env.PAGES_ORIGIN)
    if (pages.origin === new URL(request.url).origin || pages.origin !== env.PAGES_ORIGIN || (pages.protocol !== "https:" && pages.hostname !== "127.0.0.1")) return []
    if (!env.PUBLIC_PROJECTS_MANIFEST.startsWith("/") || env.PUBLIC_PROJECTS_MANIFEST.startsWith("//")) return []
    const target = new URL(env.PUBLIC_PROJECTS_MANIFEST, pages).href
    const cached = catalog_cache.get(target)
    if (cached && cached.expires > Date.now()) return cached.ids
    try {
        const response = await upstream(new Request(target, { redirect: "manual", signal: AbortSignal.timeout(5000) }))
        if (!response.ok) return []
        const ids: unknown = await response.json()
        if (!Array.isArray(ids) || ids.length > 10000 || ids.some(id => typeof id !== "string" || !valid_subdomain_id(id))) return []
        catalog_cache.set(target, { ids, expires: Date.now() + 60_000 })
        return ids
    } catch { return [] }
}

export async function host_route(request: Request, env: worker_env, projects: string[], upstream: fetcher): Promise<Response | null> {
    const url = new URL(request.url)
    if (url.hostname !== env.DOMAIN && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
        if (!url.hostname.endsWith(`.${env.DOMAIN}`)) return api_error("unknown_host", "Unknown host", 404)
        const subdomain = url.hostname.slice(0, -(env.DOMAIN.length + 1))
        if (projects.includes(subdomain)) return Response.redirect(`https://${env.DOMAIN}/projects/${subdomain}`, 301)
        // Only explicit registry origins can receive traffic. Never forward visitor cookies or auth.
        if (valid_demo_host(subdomain) || valid_subdomain_id(subdomain)) {
            const target = await env.REGISTRY?.get(`host:${subdomain}`)
            if (target) {
                const origin = new URL(target)
                if (origin.protocol !== "https:" || origin.hostname === env.DOMAIN || origin.hostname.endsWith(`.${env.DOMAIN}`)) return api_error("bad_origin", "Registry origin must be an external HTTPS origin", 503)
                const proxy = new URL(url.pathname + url.search, origin.origin)
                const headers = new Headers({ accept: request.headers.get("accept") ?? "*/*" })
                if (request.headers.has("content-type")) headers.set("content-type", request.headers.get("content-type")!)
                return upstream(new Request(proxy, { method: request.method, headers, body: ["GET", "HEAD"].includes(request.method) ? undefined : await request.arrayBuffer(), redirect: "manual" }))
            }
        }
        return api_error("unknown_host", "Unassigned subdomain", 404)
    }
    return null
}
