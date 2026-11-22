/* Tunnel-first repository host. Discovery pins one backend for the entire Git negotiation. */
import type { worker_env } from "../router/index.ts"
import { valid_subdomain_id } from "../../shared/content/ids.ts"
import { api_error, sign_origin } from "../security/headers.ts"
import { public_git_read } from "./fallback.ts"
type fetcher = (request: Request) => Promise<Response>

export function add_access_headers(headers: Headers, env: worker_env): void {
    if (!env.ACCESS_CLIENT_ID || !env.ACCESS_CLIENT_SECRET) return
    headers.set("CF-Access-Client-Id", env.ACCESS_CLIENT_ID)
    headers.set("CF-Access-Client-Secret", env.ACCESS_CLIENT_SECRET)
}

// Git smart HTTP is forwarded to the personal node as a stream. Only the headers git needs are passed on;
// the Authorization header carries the collaborator's token, which the node (not the Worker) verifies.
export async function forward_git(request: Request, env: worker_env, id: string, operation: string, search: string, upstream: fetcher): Promise<Response> {
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



async function route_repository(request: Request, env: worker_env, projects: string[], upstream: fetcher = fetch): Promise<Response> {
    const url = new URL(request.url)
    const smart = /^\/([a-z0-9-]+)(?:\/(_git\/(?:origin|source)))?\/(info\/refs|git-upload-pack|git-receive-pack)$/.exec(url.pathname)
    if (smart && valid_subdomain_id(smart[1])) {
        const [, id, pinned, operation] = smart
        const writes = operation === "git-receive-pack" || url.searchParams.get("service") === "git-receive-pack"
        if (pinned === "_git/source") {
            if (writes || !projects.includes(id)) return api_error("origin_offline", "Repository origin is required", 503)
            return public_git_read(request, env, id, operation, upstream)
        }
        const response = await forward_git(request, env, id, operation, url.search, upstream)
        if (writes || pinned || !projects.includes(id) || request.method !== "GET" || operation !== "info/refs" || url.searchParams.get("service") !== "git-upload-pack") return response
        if (response.status >= 500) {
            void response.body?.cancel().catch(() => {})
            return new Response(null, { status: 307, headers: { location: new URL(`/${id}/_git/source/info/refs${url.search}`, url).href, "cache-control": "no-store" } })
        }
        if (!response.ok) return response
        void response.body?.cancel().catch(() => {})
        return new Response(null, { status: 307, headers: { location: new URL(`/${id}/_git/origin/info/refs${url.search}`, url).href, "cache-control": "no-store" } })
    }
    const read = /^\/([a-z0-9-]+)\/_\/(refs|tree|blob|log|runs)$/.exec(url.pathname)
    if (read && projects.includes(read[1]) && request.method === "GET") {
        if (!env.PERSONAL_ORIGIN || !env.ORIGIN_HMAC_SECRET) return api_error("origin_offline", "Personal node is not configured", 503)
        const target = new URL(`/${read[2] === "runs" ? "ci" : "git"}/${read[1]}/${read[2]}${url.search}`, env.PERSONAL_ORIGIN)
        if (target.protocol !== "https:" && target.hostname !== "127.0.0.1") return api_error("bad_origin", "Personal origin requires HTTPS", 503)
        const headers = await sign_origin(new Request(target), env.ORIGIN_HMAC_SECRET, "public")
        add_access_headers(headers, env)
        try { return await upstream(new Request(target, { headers, redirect: "manual", signal: AbortSignal.timeout(10000) })) }
        catch { return api_error("origin_offline", "Personal node is unreachable", 503) }
    }
    return api_error("not_found", "Unknown repository endpoint", 404)
}

export async function repository_route(request: Request, env: worker_env, projects: string[], upstream: fetcher = fetch): Promise<Response> {
    const response = await route_repository(request, env, projects, upstream)
    if (!/\/_\//.test(new URL(request.url).pathname)) return response
    const headers = new Headers(response.headers)
    headers.set("access-control-allow-origin", `https://${env.DOMAIN}`)
    headers.set("cache-control", "no-store")
    return new Response(response.body, { status: response.status, headers })
}
