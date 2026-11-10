import { api_error, secure_response, sign_origin } from "./security.ts"

type object_result = {
    body?: ReadableStream<Uint8Array>
    httpEtag: string
    size: number
    range?: { offset: number, length: number }
    writeHttpMetadata(headers: Headers): void
}
export type worker_env = {
    DOMAIN: string
    PAGES_ORIGIN: string
    PUBLIC_PROJECTS?: string
    PERSONAL_ORIGIN?: string
    ORIGIN_HMAC_SECRET?: string
    ACCESS_CLIENT_ID?: string
    ACCESS_CLIENT_SECRET?: string
    ASSETS?: { get(key: string, options?: { range: Headers, onlyIf: Headers }): Promise<object_result | null> }
    REGISTRY?: { get(key: string): Promise<string | null> }
}
type fetcher = (request: Request) => Promise<Response>

export async function route(request: Request, env: worker_env, upstream: fetcher = fetch): Promise<Response> {
    const url = new URL(request.url)
    let path: string
    try { path = decodeURIComponent(url.pathname) } catch { return api_error("bad_path", "Invalid URL encoding", 400) }
    if (path.includes("\\") || path.includes("\0") || path.split("/").some(part => part === ".." || part.startsWith("."))) {
        // RFC security contact is the one public dot-directory endpoint.
        if (path !== "/.well-known/security.txt") return api_error("bad_path", "Invalid path", 400)
    }
    const projects: string[] = JSON.parse(env.PUBLIC_PROJECTS ?? "[]")
    if (url.hostname !== env.DOMAIN && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
        if (!url.hostname.endsWith(`.${env.DOMAIN}`)) return api_error("unknown_host", "Unknown host", 404)
        const subdomain = url.hostname.slice(0, -(env.DOMAIN.length + 1))
        if (projects.includes(subdomain)) return Response.redirect(`https://${env.DOMAIN}/projects/${subdomain}`, 301)
        // Only explicit registry origins can receive traffic. Never forward visitor cookies or auth.
        if (/^[a-z0-9_-]+-(demo|work)$/.test(subdomain)) {
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
    if (path.startsWith("/api/")) {
        if (path === "/api/v1/health" && ["GET", "HEAD"].includes(request.method)) return Response.json({ status: "ok", generation: 12, services: { work: "not_implemented" } }, { headers: { "cache-control": "no-store" } })
        const git = /^\/api\/v1\/git\/([a-z0-9_-]+)(\/.*)?$/.exec(path)
        if (git && projects.includes(git[1]) && request.method === "GET") {
            if (!env.PERSONAL_ORIGIN || !env.ORIGIN_HMAC_SECRET) return api_error("origin_offline", "Personal node is not configured", 503)
            const target = new URL(`/git/${git[1]}${git[2] ?? "/refs"}${url.search}`, env.PERSONAL_ORIGIN)
            if (target.protocol !== "https:" && target.hostname !== "127.0.0.1") return api_error("bad_origin", "Personal origin requires HTTPS", 503)
            const origin_request = new Request(target)
            const headers = await sign_origin(origin_request, env.ORIGIN_HMAC_SECRET, "public")
            if (env.ACCESS_CLIENT_ID && env.ACCESS_CLIENT_SECRET) {
                headers.set("CF-Access-Client-Id", env.ACCESS_CLIENT_ID)
                headers.set("CF-Access-Client-Secret", env.ACCESS_CLIENT_SECRET)
            }
            try {
                const response = await upstream(new Request(target, { headers, redirect: "manual", signal: AbortSignal.timeout(10_000) }))
                if (response.status >= 300 && response.status < 400) return api_error("origin_unavailable", "Personal node rejected the request", 503)
                return response
            } catch { return api_error("origin_offline", "Personal node is unreachable", 503) }
        }
        return api_error("not_implemented", "This API is not enabled; no client data is accepted", 501)
    }
    if (!["GET", "HEAD"].includes(request.method)) return api_error("method_not_allowed", "Static routes allow GET and HEAD", 405)
    if (path.startsWith("/assets/media/") || path.startsWith("/assets/wasm/")) {
        const object = await env.ASSETS?.get(path.slice(1), { range: request.headers, onlyIf: request.headers })
        if (object) {
            const headers = new Headers({ etag: object.httpEtag, "accept-ranges": "bytes", "cache-control": "public, max-age=31536000, immutable", "access-control-allow-origin": `https://${env.DOMAIN}` })
            object.writeHttpMetadata(headers)
            if (path === "/assets/wasm/manifest.json") headers.set("cache-control", "no-cache")
            if (path.endsWith(".wasm")) headers.set("content-type", "application/wasm")
            if (path.endsWith(".js")) headers.set("content-type", "text/javascript")
            if (path.endsWith(".json")) headers.set("content-type", "application/json")
            if (path.endsWith(".zip")) headers.set("content-type", "application/zip")
            if (path.endsWith(".whl")) headers.set("content-type", "application/octet-stream")
            if (!object.body) return new Response(null, { status: request.headers.has("if-none-match") ? 304 : 412, headers })
            if (object.range) headers.set("content-range", `bytes ${object.range.offset}-${object.range.offset + object.range.length - 1}/${object.size}`)
            return new Response(request.method === "HEAD" ? null : object.body, { status: object.range ? 206 : 200, headers })
        }
    }
    const pages = new URL(env.PAGES_ORIGIN)
    if (pages.hostname === url.hostname || pages.origin !== env.PAGES_ORIGIN || (pages.protocol !== "https:" && pages.hostname !== "127.0.0.1")) return api_error("bad_origin", "Configure a distinct Pages HTTPS origin", 503)
    // Only public request headers are forwarded to Pages; UUID query secrets never reach it.
    const target = new URL(url.pathname === "/work" ? "/work" : url.pathname + url.search, pages)
    const headers = new Headers()
    for (const name of ["accept", "accept-encoding", "range", "if-none-match", "if-modified-since"]) if (request.headers.has(name)) headers.set(name, request.headers.get(name)!)
    return upstream(new Request(target, { method: request.method, headers, redirect: "manual" }))
}

export default {
    async fetch(request: Request, env: worker_env): Promise<Response> {
        try { return secure_response(await route(request, env), new URL(request.url).pathname === "/work") }
        catch { return secure_response(api_error("unavailable", "Service temporarily unavailable", 503)) }
    },
}
