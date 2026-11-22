/* Owner- and CSRF-protected pipeline hooks forwarded over the signed origin transport. */
import { read_session, valid_csrf } from "./auth.ts"
import type { worker_env } from "../router/index.ts"
import { api_error, sign_origin } from "../security/headers.ts"
import { add_access_headers } from "../repo/front.ts"
import { valid_subdomain_id } from "../../shared/content/ids.ts"

export async function projects_route(request: Request, env: worker_env, upstream: typeof fetch = fetch): Promise<Response> {
    const match = /^\/api\/_\/projects\/([a-z0-9-]+)\/([a-z0-9][a-z0-9-]{0,63})$/.exec(new URL(request.url).pathname)
    if (!match || !valid_subdomain_id(match[1])) return api_error("not_found", "Unknown project hook", 404)
    if (request.method !== "POST") return api_error("method_not_allowed", "Use POST", 405)
    const session = await read_session(request, env)
    if (!session || session.role !== "owner" || !valid_csrf(request, session)) return api_error("forbidden", "Owner sign-in and CSRF required", 403)
    if (!env.PERSONAL_ORIGIN || !env.ORIGIN_HMAC_SECRET) return api_error("origin_offline", "Personal server is not configured", 503)
    const target = new URL(`/projects/${match[1]}/${match[2]}`, env.PERSONAL_ORIGIN)
    if (target.protocol !== "https:" && target.hostname !== "127.0.0.1") return api_error("bad_origin", "Personal origin requires HTTPS", 503)
    const headers = await sign_origin(new Request(target, { method: "POST" }), env.ORIGIN_HMAC_SECRET, "pipeline")
    add_access_headers(headers, env)
    try {
        const response = await upstream(new Request(target, { method: "POST", headers, redirect: "manual", signal: AbortSignal.timeout(15000) }))
        if (response.status >= 300 && response.status < 400) return api_error("origin_unavailable", "Personal server rejected the hook", 503)
        return new Response(response.body, { status: response.status, headers: { "content-type": "application/json", "cache-control": "no-store" } })
    } catch { return api_error("origin_offline", "Personal server is unreachable", 503) }
}
