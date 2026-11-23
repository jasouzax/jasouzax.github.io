/* Versioned custom API routing only. The personal server remains authoritative for access, tokens, limits and schemas. */
import type { worker_env } from "./router/index.ts"
import { read_session, valid_csrf } from "./api/auth.ts"
import { api_error, sign_origin } from "./security/headers.ts"
import { add_access_headers } from "./repo/front.ts"
import { api_header, api_limit, api_transport_limit, api_methods, type Api_Call, type Api_Manifest, type Api_Result } from "../shared/api/types.ts"
import { valid_subdomain_id } from "../shared/content/ids.ts"
import { match_route, route_segments } from "../shared/api/routes.ts"
type Fetcher = (request: Request) => Promise<Response>
const manifests = new Map<string, { value: Api_Manifest, expires: number }>()
export function versioned_target(path: string): { id: string, version: number, path: string } | null {
    const match = /^\/api\/([a-z0-9-]+)\/v([1-9][0-9]{0,3})(\/.*)?$/.exec(path)
    return match && valid_subdomain_id(match[1]) ? { id: match[1], version: Number(match[2]), path: match[3] || "/" } : null
}
async function bounded_body(request: Request): Promise<{ value: unknown, raw?: string }> {
    if (!request.body) return { value: undefined }
    if (!request.headers.get("content-type")?.startsWith("application/json")) throw new Error("content_type")
    const reader = request.body.getReader(), chunks: Uint8Array[] = []; let size = 0
    try { while (true) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > api_limit) throw new Error("body_limit"); chunks.push(next.value) } }
    finally { await reader.cancel() }
    const bytes = new Uint8Array(size); let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    return { value: size ? JSON.parse(raw) : undefined, raw }
}
async function origin_call(env: worker_env, path: string, body: unknown, upstream: Fetcher): Promise<Response> {
    const origin = new URL(env.PERSONAL_ORIGIN!)
    if (origin.origin !== env.PERSONAL_ORIGIN || origin.username || origin.password || origin.protocol !== "https:" && !["127.0.0.1", "localhost"].includes(origin.hostname)) throw new Error("Invalid API origin")
    const target = new URL(path, origin), text = JSON.stringify(body)
    const headers = await sign_origin(new Request(target, { method: "POST", body: text }), env.ORIGIN_HMAC_SECRET!, "api-gateway")
    add_access_headers(headers, env); headers.set("content-type", "application/json")
    return upstream(new Request(target, { method: "POST", body: text, headers, redirect: "manual", signal: AbortSignal.timeout(35000) }))
}
export async function custom_api_route(request: Request, env: worker_env, upstream: Fetcher = fetch): Promise<Response> {
    const url = new URL(request.url), target = versioned_target(url.pathname)
    if (!target) return api_error("not_found", "Unknown versioned API", 404)
    if (!env.PERSONAL_ORIGIN || !env.ORIGIN_HMAC_SECRET) return api_error("api_offline", "Custom API origin is unavailable", 503)
    if (!api_methods.includes(request.method as any)) return api_error("method_not_allowed", "Unsupported API method", 405)
    let segments: string[], body: { value: unknown, raw?: string }
    try { segments = route_segments(target.path); body = await bounded_body(request) }
    catch (error) { const code = (error as Error).message; return api_error(code === "body_limit" ? "body_too_large" : code === "content_type" ? "unsupported_media_type" : "invalid_request", "Use a bounded JSON body and valid API path", code === "body_limit" ? 413 : code === "content_type" ? 415 : 400) }
    const session = await read_session(request, env)
    if (session && !["GET", "HEAD", "OPTIONS", "QUERY"].includes(request.method) && !valid_csrf(request, session)) return api_error("forbidden", "Custom API cookie requests require CSRF", 403)
    try {
        const cache_key = `${env.PERSONAL_ORIGIN}/${target.id}/v${target.version}`, cached = manifests.get(cache_key)
        let manifest = cached && cached.expires > Date.now() ? cached.value : null
        if (!manifest) {
            const response = await origin_call(env, "/custom-api/_/manifest", { id: target.id, version: target.version }, upstream)
            if (response.status !== 200) return api_error(response.status === 404 ? "not_found" : "api_offline", "API unavailable", response.status === 404 ? 404 : 503)
            manifest = await response.json() as Api_Manifest
            if (manifest.id !== target.id || manifest.version !== target.version || !Array.isArray(manifest.routes) || manifest.routes.length > 256 || manifest.routes.some(route => route.headers && (!Array.isArray(route.headers) || route.headers.length > 16 || route.headers.some(name => !api_header(name))))) throw new Error("Invalid API manifest")
            manifests.set(cache_key, { value: manifest, expires: Date.now() + 60000 })
            if (manifests.size > 128) manifests.delete(manifests.keys().next().value!)
        }
        const routes = manifest.routes.filter(route => match_route(route_segments(route.path, true), segments))
        if (!routes.length) return api_error("not_found", "API route unavailable", 404)
        const declared = routes.find(route => route.method === request.method) ?? (request.method === "HEAD" ? routes.find(route => route.method === "GET") : undefined) ?? routes[0]
        const query: Api_Call["query"] = Object.create(null)
        for (const [name, value] of url.searchParams) { const old = query[name]; query[name] = old === undefined ? value : Array.isArray(old) ? [...old, value] : [old, value] }
        const headers: Record<string, string> = {}
        for (const name of new Set(["authorization", "content-type", "accept", "idempotency-key", ...(declared.headers ?? [])])) if (request.headers.has(name)) { const value = request.headers.get(name)!; if (value.length > 2048) return api_error("invalid_request", "API header exceeds the transport limit", 400); headers[name] = value }
        const call: Api_Call = { method: request.method, path: target.path, query, headers, ...(declared.raw ? { raw_body: body.raw ?? "" } : { body: body.value }), actor: { owner: session?.role === "owner" && !session.passkey_pending, ...(session ? { subject: session.subject } : {}) }, ip: request.headers.get("cf-connecting-ip") ?? "anonymous", request_id: crypto.randomUUID() }
        if (new TextEncoder().encode(JSON.stringify(call)).length > api_transport_limit) return api_error("body_too_large", "API call exceeds the transport limit", 413)
        const response = await origin_call(env, `/custom-api/${target.id}/v${target.version}`, call, upstream)
        if (response.status !== 200) return api_error("api_offline", "API origin rejected the request", 503)
        const result = await response.json() as Api_Result
        if (!Number.isInteger(result.status) || result.status < 200 || result.status > 599 || JSON.stringify(result.body).length > api_limit) throw new Error("Invalid API response envelope")
        const output = new Headers({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "content-security-policy": "sandbox; default-src 'none'; frame-ancestors 'none'", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" })
        for (const [name, value] of Object.entries(result.headers ?? {})) if (/^(x-[a-z0-9-]+|etag|last-modified|location|retry-after|deprecation|sunset)$/i.test(name) && !/^(x-content-type-options|x-frame-options)$/i.test(name)) output.set(name, value)
        return new Response(request.method === "HEAD" || [204, 304].includes(result.status) ? null : JSON.stringify(result.body), { status: result.status, headers: output })
    } catch { return api_error("api_offline", "Custom API origin is unavailable", 503) }
}
