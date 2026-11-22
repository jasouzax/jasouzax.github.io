/*
 * Worker routes of the /server feature: who may do what, then a hand-off to the Server_Hub Durable Object.
 *
 * Entities
 *   server_route    /api/server (public status), /api/server/ws (owner's page), /api/server/agent (the Pi)
 *   gateway_route   /api/{name}/... for APIs that scripts on the Pi publish
 *   is_owner        the signed-in session belongs to an allowed owner e-mail
 *
 * Responsibilities
 *   Owner = Jazu's own session (read_session) whose verified Google e-mail is in SERVER_OWNER_EMAILS (default GOOGLE_ADMIN_EMAIL). Decided here, never in the object.
 *   The agent proves itself with the HMAC of src/node/security.ts (SERVER_AGENT_SECRET); replays are refused.
 *   The public status is cached at the edge for a minute, so visitors cost the Durable Object nothing beyond one refresh a minute.
 *   Gateway requests never carry the session cookie to a script and a script's reply can never set a cookie or run as the site (CSP sandbox).
 * Limits
 *   Without the SERVER_HUB binding every route here fails closed (503), and unknown /api/* paths keep their 501.
 */
import { agent_client_id, api_body_limit, api_name_pattern, reserved_api_names } from "../../shared/protocol/wire.ts"
import type { Public_Status } from "../../shared/protocol/wire.ts"
import { read_session } from "./auth.ts"
import { api_error, verify_origin } from "./security.ts"
import type { Work_Env } from "./work.ts"

export type Hub_Namespace = { idFromName(name: string): unknown, get(id: unknown): { fetch(request: Request): Promise<Response> } }
export type Server_Env = Work_Env & { SERVER_HUB?: Hub_Namespace, SERVER_AGENT_SECRET?: string, SERVER_OWNER_EMAILS?: string }
export type Edge_Cache = { match(request: Request): Promise<Response | undefined>, put(request: Request, response: Response): Promise<void> }

const seen_nonces = new Map<string, number>()
const reserved = new Set<string>(reserved_api_names)
const gateway_methods = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"])
// Request headers a script may read; `cookie` is deliberately absent
const forwarded_request_headers = ["accept", "accept-language", "content-type", "user-agent", "authorization", "if-none-match"]
// Reply headers a script may set; `set-cookie` is deliberately absent
const allowed_reply_headers = ["content-type", "content-disposition", "location", "cache-control", "etag", "last-modified", "allow", "content-language"]

export function owner_emails(env: Server_Env): string[] {
    return (env.SERVER_OWNER_EMAILS ?? env.GOOGLE_ADMIN_EMAIL ?? "").split(",").map(email => email.trim().toLowerCase()).filter(Boolean)
}

export async function is_owner(request: Request, env: Server_Env): Promise<boolean> {
    // No cookie, no D1 read: strangers never cost a query
    if (!request.headers.get("cookie")?.includes("jazu_session=")) return false
    const session = await read_session(request, env).catch(() => null)
    return Boolean(session && owner_emails(env).includes(session.email.toLowerCase()))
}

function hub_of(env: Server_Env) {
    return env.SERVER_HUB?.get(env.SERVER_HUB.idFromName("main")) ?? null
}

function internal(path: string, role: string, extra: Record<string, string> = {}, init: RequestInit = {}): Request {
    return new Request(`https://server.internal${path}`, { ...init, headers: { "x-jazu-role": role, ...extra, ...(init.headers as Record<string, string> | undefined) } })
}

export function gateway_target(path: string): { name: string, rest: string } | null {
    const match = /^\/api\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})(?:\/(.*))?$/.exec(path)
    return match && api_name_pattern.test(match[1]) && !reserved.has(match[1].toLowerCase()) ? { name: match[1], rest: match[2] ?? "" } : null
}

export async function server_route(request: Request, env: Server_Env, cache: Edge_Cache | undefined = (globalThis as { caches?: { default?: Edge_Cache } }).caches?.default): Promise<Response> {
    const url = new URL(request.url)
    const hub = hub_of(env)
    if (!hub) return api_error("server_unconfigured", "The server desk is not configured", 503)
    if (url.pathname === "/api/server") return status_route(request, env, hub, cache)
    if (url.pathname === "/api/server/ws") return owner_socket(request, env, hub)
    if (url.pathname === "/api/server/agent") return agent_socket(request, env, hub)
    return api_error("not_found", "Unknown route", 404)
}

async function status_route(request: Request, env: Server_Env, hub: { fetch(request: Request): Promise<Response> }, cache: Edge_Cache | undefined): Promise<Response> {
    if (!["GET", "HEAD"].includes(request.method)) return api_error("method_not_allowed", "Use GET", 405)
    const owner = await is_owner(request, env)
    const key = new Request(new URL("/api/server", request.url).href)
    if (!owner) {
        const hit = await cache?.match(key)
        if (hit) return hit
    }
    let status: Omit<Public_Status, "owner">
    try { status = await (await hub.fetch(internal("/status", "worker"))).json() } catch { return api_error("origin_unavailable", "The server desk is unavailable", 503) }
    // `owner` is only ever true for the owner's own (never cached) answer
    const response = Response.json({ ...status, owner }, { headers: { "cache-control": owner ? "no-store" : "public, max-age=60", vary: "Cookie" } })
    if (!owner && cache) await cache.put(key, response.clone())
    return response
}

async function owner_socket(request: Request, env: Server_Env, hub: { fetch(request: Request): Promise<Response> }): Promise<Response> {
    if (request.method !== "GET" || request.headers.get("upgrade")?.toLowerCase() !== "websocket") return api_error("upgrade_required", "Use a WebSocket", 426)
    if (request.headers.get("origin") !== new URL(request.url).origin) return api_error("forbidden", "Use this site's page", 403)
    if (!await is_owner(request, env)) return api_error("forbidden", "Only the owner can open the server", 403)
    return hub.fetch(internal("/connect-owner", "owner", { upgrade: "websocket" }))
}

async function agent_socket(request: Request, env: Server_Env, hub: { fetch(request: Request): Promise<Response> }): Promise<Response> {
    if (request.method !== "GET" || request.headers.get("upgrade")?.toLowerCase() !== "websocket") return api_error("upgrade_required", "Use a WebSocket", 426)
    if (!env.SERVER_AGENT_SECRET) return api_error("server_unconfigured", "The agent secret is not set", 503)
    if (request.headers.get("x-jazu-client") !== agent_client_id || !await verify_origin(request, env.SERVER_AGENT_SECRET, seen_nonces)) return api_error("unauthorized", "Invalid agent signature", 401)
    return hub.fetch(internal("/connect-agent", "agent", { upgrade: "websocket" }))
}

function decode_path(rest: string): string | null {
    const parts: string[] = []
    for (const part of rest.split("/")) {
        let decoded: string
        try { decoded = decodeURIComponent(part) } catch { return null }
        if (decoded.includes("/") || decoded.includes("\0") || decoded === "..") return null
        if (decoded !== "") parts.push(decoded)
    }
    return parts.join("/")
}

async function read_body(request: Request): Promise<Uint8Array | null> {
    if (["GET", "HEAD"].includes(request.method) || !request.body) return new Uint8Array()
    if (Number(request.headers.get("content-length") ?? 0) > api_body_limit) return null
    const bytes = new Uint8Array(await request.arrayBuffer())
    return bytes.length > api_body_limit ? null : bytes
}

function to_base64(bytes: Uint8Array): string {
    let binary = ""
    for (let start = 0; start < bytes.length; start += 0x8000) binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000))
    return btoa(binary)
}

export async function gateway_route(request: Request, env: Server_Env, name: string, rest: string): Promise<Response> {
    const hub = hub_of(env)
    if (!hub) return api_error("not_implemented", "This API is not enabled; no client data is accepted", 501)
    if (!gateway_methods.has(request.method)) return api_error("method_not_allowed", "Method not allowed", 405)
    const path = decode_path(rest)
    if (path === null) return api_error("bad_path", "Invalid path", 400)
    const body = await read_body(request)
    if (body === null) return api_error("too_large", "The request body is too large", 413)
    const url = new URL(request.url)
    const query: Record<string, string | string[]> = {}
    for (const [key, value] of url.searchParams) {
        const known = query[key]
        query[key] = known === undefined ? value : Array.isArray(known) ? [...known, value] : [known, value]
    }
    const headers: Record<string, string> = {}
    for (const header of forwarded_request_headers) if (request.headers.has(header)) headers[header] = request.headers.get(header)!
    const owner = await is_owner(request, env)
    const call = { name, method: request.method === "HEAD" ? "GET" : request.method, path, query, headers, body: to_base64(body), ip: request.headers.get("cf-connecting-ip") ?? "", owner }
    let answered: Response
    try { answered = await hub.fetch(internal("/call", "gateway", { "content-type": "application/json" }, { method: "POST", body: JSON.stringify(call) })) } catch { return api_error("origin_unavailable", "The server desk is unavailable", 503) }
    // Errors of the object (404, 429, 503, 504) are already complete answers
    if (!answered.headers.get("content-type")?.includes("json")) return answered
    const result = await answered.clone().json() as { status?: number, headers?: Record<string, string>, body?: string, error?: unknown }
    if (typeof result.status !== "number") return answered
    return script_reply(request, result as { status: number, headers: Record<string, string>, body: string }, owner)
}

function script_reply(request: Request, result: { status: number, headers: Record<string, string>, body: string }, owner: boolean): Response {
    const headers = new Headers()
    for (const [name, value] of Object.entries(result.headers ?? {})) if (allowed_reply_headers.includes(name.toLowerCase()) && typeof value === "string") headers.set(name, value)
    // The reply is the script's data, not the site's: an opaque origin keeps it away from the session cookie
    headers.set("content-security-policy", "sandbox")
    headers.set("vary", "Cookie")
    if (owner || !headers.has("cache-control")) headers.set("cache-control", "no-store")
    const status = Number.isInteger(result.status) && result.status >= 200 && result.status <= 599 ? result.status : 502
    const bytes = Uint8Array.from(atob(result.body ?? ""), char => char.charCodeAt(0))
    return new Response(request.method === "HEAD" || [204, 205, 304].includes(status) ? null : bytes, { status, headers })
}
