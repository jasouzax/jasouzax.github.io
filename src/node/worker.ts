import { api_error, secure_response, sign_origin, is_work_path } from "./security.ts"
import { public_git_read } from "./git_read_proxy.ts"
import { work_route, type Work_Env } from "./work.ts"
import { auth_route } from "./auth.ts"

type object_result = {
    body?: ReadableStream<Uint8Array>
    httpEtag: string
    size: number
    range?: { offset: number, length: number }
    writeHttpMetadata(headers: Headers): void
}
export type worker_env = Work_Env & {
    DOMAIN: string
    PAGES_ORIGIN: string
    PUBLIC_PROJECTS?: string
    PUBLIC_PROJECTS_MANIFEST?: string
    PROJECT_CLONE_ORIGINS?: string
    PERSONAL_ORIGIN?: string
    ORIGIN_HMAC_SECRET?: string
    ACCESS_CLIENT_ID?: string
    ACCESS_CLIENT_SECRET?: string
    ASSETS?: { get(key: string, options?: { range: Headers, onlyIf: Headers }): Promise<object_result | null> }
    REGISTRY?: { get(key: string): Promise<string | null> }
}
type fetcher = (request: Request) => Promise<Response>
const catalog_cache = new Map<string, { expires: number, ids: string[] }>()

async function catalog_projects(request: Request, env: worker_env, upstream: fetcher): Promise<string[]> {
    if (!env.PUBLIC_PROJECTS_MANIFEST) return []
    const pages = new URL(env.PAGES_ORIGIN)
    if (pages.hostname === new URL(request.url).hostname || pages.origin !== env.PAGES_ORIGIN || (pages.protocol !== "https:" && pages.hostname !== "127.0.0.1")) return []
    if (!env.PUBLIC_PROJECTS_MANIFEST.startsWith("/") || env.PUBLIC_PROJECTS_MANIFEST.startsWith("//")) return []
    const target = new URL(env.PUBLIC_PROJECTS_MANIFEST, pages).href
    const cached = catalog_cache.get(target)
    if (cached && cached.expires > Date.now()) return cached.ids
    try {
        const response = await upstream(new Request(target, { redirect: "manual", signal: AbortSignal.timeout(5000) }))
        if (!response.ok) return []
        const ids: unknown = await response.json()
        if (!Array.isArray(ids) || ids.length > 10000 || ids.some(id => typeof id !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id))) return []
        catalog_cache.set(target, { ids, expires: Date.now() + 60_000 })
        return ids
    } catch { return [] }
}

function add_access_headers(headers: Headers, env: worker_env): void {
    if (!env.ACCESS_CLIENT_ID || !env.ACCESS_CLIENT_SECRET) return
    headers.set("CF-Access-Client-Id", env.ACCESS_CLIENT_ID)
    headers.set("CF-Access-Client-Secret", env.ACCESS_CLIENT_SECRET)
}

// Git smart HTTP is forwarded to the personal node as a stream. Only the headers git needs are passed on;
// the Authorization header carries the collaborator's token, which the node (not the Worker) verifies.
async function forward_git(request: Request, env: worker_env, id: string, operation: string, search: string, upstream: fetcher): Promise<Response> {
    if (!env.PERSONAL_ORIGIN || !env.ORIGIN_HMAC_SECRET) return api_error("origin_offline", "Personal node is not configured", 503)
    const method = operation === "info/refs" ? "GET" : "POST"
    if (request.method !== method) return api_error("method_not_allowed", `Use ${method}`, 405)
    const target = new URL(`/git-http/${id}.git/${operation}${search}`, env.PERSONAL_ORIGIN)
    if (target.protocol !== "https:" && target.hostname !== "127.0.0.1") return api_error("bad_origin", "Personal origin requires HTTPS", 503)
    const headers = await sign_origin(new Request(target, { method }), env.ORIGIN_HMAC_SECRET, "git", Date.now(), "stream")
    add_access_headers(headers, env)
    for (const name of ["authorization", "content-type", "content-encoding", "git-protocol"]) if (request.headers.has(name)) headers.set(name, request.headers.get(name)!)
    const init: RequestInit & { duplex?: "half" } = { method, headers, redirect: "manual", signal: AbortSignal.timeout(10 * 60_000) }
    if (method === "POST") { init.body = request.body; init.duplex = "half" }
    try {
        const response = await upstream(new Request(target, init))
        if (response.status >= 300 && response.status < 400) return api_error("origin_unavailable", "Personal node rejected the request", 503)
        return response
    } catch { return api_error("origin_offline", "Personal node is unreachable", 503) }
}


// Oversized website assets and Git packs share the static R2 transport, including ranges and conditional reads.
async function static_object(request: Request, env: worker_env, key: string): Promise<Response | null> {
    const path = `/${key}`
    const object = await env.ASSETS?.get(key, { range: request.headers, onlyIf: request.headers })
    if (object) {
        const headers = new Headers({ etag: object.httpEtag, "accept-ranges": "bytes", "cache-control": "public, max-age=31536000, immutable", "access-control-allow-origin": `https://${env.DOMAIN}` })
        object.writeHttpMetadata(headers)
        if (path === "/assets/wasm/manifest.json") headers.set("cache-control", "no-cache")
        if (path.endsWith(".wasm")) headers.set("content-type", "application/wasm")
        if (path.endsWith(".js")) headers.set("content-type", "text/javascript")
        if (path.endsWith(".json")) headers.set("content-type", "application/json")
        if (path.endsWith(".zip")) headers.set("content-type", "application/zip")
        if (/\.(whl|pack|idx)$/.test(path)) headers.set("content-type", "application/octet-stream")
        if (!object.body) return new Response(null, { status: request.headers.has("if-none-match") ? 304 : 412, headers })
        if (object.range) headers.set("content-range", `bytes ${object.range.offset}-${object.range.offset + object.range.length - 1}/${object.size}`)
        return new Response(request.method === "HEAD" ? null : object.body, { status: object.range ? 206 : 200, headers })
    }
    return null
}

export async function route(request: Request, env: worker_env, upstream: fetcher = fetch): Promise<Response> {
    const url = new URL(request.url)
    let path: string
    try { path = decodeURIComponent(url.pathname) } catch { return api_error("bad_path", "Invalid URL encoding", 400) }
    if (path.includes("\\") || path.includes("\0") || path.split("/").some(part => part === ".." || part.startsWith("."))) {
        // RFC security contact is the one public dot-directory endpoint.
        if (path !== "/.well-known/security.txt") return api_error("bad_path", "Invalid path", 400)
    }
    const projects: string[] = JSON.parse(env.PUBLIC_PROJECTS ?? "[]")
    const candidate = /^\/(?:projects\/([a-z0-9_-]+)(?:\.git)?\/|api\/v1\/(?:git|ci)\/([a-z0-9_-]+)(?:\/|$))/.exec(path)
    const subdomain = url.hostname.endsWith(`.${env.DOMAIN}`) ? url.hostname.slice(0, -(env.DOMAIN.length + 1)) : undefined
    const requested_project = candidate?.[1] ?? candidate?.[2] ?? subdomain
    if (requested_project && !projects.includes(requested_project)) projects.push(...await catalog_projects(request, env, upstream))
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
    // Configured public reads prefer their provider, then Pi. Legacy deployments retain the static mirror.
    // Writes and private reads always use the signed personal backend, including after a Pi discovery redirect.
    const smart = /^\/projects\/([a-z0-9_-]+)(?:\.git)?(?:\/(_git\/pi))?\/(info\/refs|git-upload-pack|git-receive-pack)$/.exec(path)
    if (smart) {
        const [, id, pinned, operation] = smart
        const writes = operation === "git-receive-pack" || (operation === "info/refs" && url.searchParams.get("service") === "git-receive-pack")
        if (writes || !projects.includes(id) || pinned) return forward_git(request, env, id, operation, url.search, upstream)
        if (env.PROJECT_CLONE_ORIGINS !== undefined && (operation === "git-upload-pack" || url.searchParams.get("service") === "git-upload-pack"))
            return public_git_read(request, env, id, operation, upstream, retry => forward_git(retry, env, id, operation, url.search, upstream))
    }
    // Both clone URLs use the same static mirror. The project HTML at /projects/{id} stays a normal page.
    const mirror = /^\/projects\/([a-z0-9_-]+)(?:\.git)?\/(HEAD|info\/refs|objects\/info\/packs|objects\/pack\/pack-[0-9a-f]+\.(?:pack|idx))$/.exec(path)
    if (mirror && projects.includes(mirror[1])) {
        if (!["GET", "HEAD"].includes(request.method)) return api_error("method_not_allowed", "Static Git routes allow GET and HEAD", 405)
        if (mirror[2].startsWith("objects/pack/")) {
            const packed = await static_object(request, env, `projects/${mirror[1]}.git/${mirror[2]}`)
            if (packed) return packed
        }
        const pages = new URL(env.PAGES_ORIGIN)
        if (pages.hostname === url.hostname || pages.origin !== env.PAGES_ORIGIN || (pages.protocol !== "https:" && pages.hostname !== "127.0.0.1")) return api_error("bad_origin", "Configure a distinct Pages HTTPS origin", 503)
        const headers = new Headers()
        for (const name of ["range", "if-none-match", "if-modified-since"]) if (request.headers.has(name)) headers.set(name, request.headers.get(name)!)
        const target = new URL(`/projects/${mirror[1]}.git/${mirror[2]}`, pages)
        const response = await upstream(new Request(target, { method: request.method, headers, redirect: "manual" }))
        const output = new Headers(response.headers)
        output.set("cache-control", mirror[2].startsWith("objects/pack/") ? "public, max-age=31536000, immutable" : "no-cache")
        output.set("content-type", mirror[2].startsWith("objects/pack/") ? "application/octet-stream" : "text/plain; charset=utf-8")
        return new Response(response.body, { status: response.status, statusText: response.statusText, headers: output })
    }
    if (path === "/api" || path.startsWith("/api/")) {
        if (path.startsWith("/api/v1/auth/")) return auth_route(request, env)
        if (path === "/api" && ["GET", "HEAD"].includes(request.method)) return Response.json({ name: "jazu", version: "v1", health: "/api/v1/health", git: "/api/v1/git/jazu/refs", runs: "/api/v1/ci/jazu/runs" }, { headers: { "cache-control": "no-store" } })
        if (path === "/api/v1/health" && ["GET", "HEAD"].includes(request.method)) return Response.json({ status: "ok", generation: 12, services: { work: env.DB && ((env.WORK_OWNER_TOKEN?.length ?? 0) >= 32 || (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)) ? "encrypted_chat" : "not_configured" } }, { headers: { "cache-control": "no-store" } })
        if (path === "/api/v1/work" || path.startsWith("/api/v1/work/")) return work_route(request, env)
        const read = /^\/api\/v1\/(git|ci)\/([a-z0-9_-]+)(\/.*)?$/.exec(path)
        if (read && projects.includes(read[2]) && request.method === "GET") {
            if (!env.PERSONAL_ORIGIN || !env.ORIGIN_HMAC_SECRET) return api_error("origin_offline", "Personal node is not configured", 503)
            const target = new URL(`/${read[1]}/${read[2]}${read[3] ?? (read[1] === "ci" ? "/runs" : "/refs")}${url.search}`, env.PERSONAL_ORIGIN)
            if (target.protocol !== "https:" && target.hostname !== "127.0.0.1") return api_error("bad_origin", "Personal origin requires HTTPS", 503)
            const origin_request = new Request(target)
            const headers = await sign_origin(origin_request, env.ORIGIN_HMAC_SECRET, "public")
            add_access_headers(headers, env)
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
        const response = await static_object(request, env, path.slice(1))
        if (response) return response
    }
    const pages = new URL(env.PAGES_ORIGIN)
    if (pages.hostname === url.hostname || pages.origin !== env.PAGES_ORIGIN || (pages.protocol !== "https:" && pages.hostname !== "127.0.0.1")) return api_error("bad_origin", "Configure a distinct Pages HTTPS origin", 503)
    // Only public request headers are forwarded to Pages; UUID query secrets never reach it.
    const target = new URL(is_work_path(path) ? url.pathname : url.pathname + url.search, pages)
    const headers = new Headers()
    for (const name of ["accept", "accept-encoding", "range", "if-none-match", "if-modified-since"]) if (request.headers.has(name)) headers.set(name, request.headers.get(name)!)
    return upstream(new Request(target, { method: request.method, headers, redirect: "manual" }))
}

export default {
    async fetch(request: Request, env: worker_env): Promise<Response> {
        const path = new URL(request.url).pathname
        const private_response = is_work_path(path) || path.startsWith("/api/v1/auth/")
        try { return secure_response(await route(request, env), private_response) }
        catch { return secure_response(api_error("unavailable", "Service temporarily unavailable", 503), private_response) }
    },
}
