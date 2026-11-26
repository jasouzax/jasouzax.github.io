/* Owner-only BFF for the Node API supervisor. Browser credentials never cross the origin transport. */
import type { worker_env } from "../router/index.ts"
import { read_session, valid_csrf } from "./auth.ts"
import { api_error, sign_origin } from "../security/headers.ts"
import { add_access_headers } from "../repo/front.ts"
import { valid_subdomain_id } from "../../shared/content/ids.ts"

export async function apis_route(request: Request, env: worker_env, upstream: typeof fetch = fetch): Promise<Response> {
    const session = await read_session(request, env)
    if (session?.role !== "owner" || session.passkey_pending) return api_error("not_found", "Not found", 404)
    const path = new URL(request.url).pathname, action = path === "/api/_/apis" ? "status" : path.slice("/api/_/apis/".length)
    if (!["status", "deploy", "rollback", "stop"].includes(action)) return api_error("not_found", "Unknown API command", 404)
    if (request.method !== (action === "status" ? "GET" : "POST")) return api_error("method_not_allowed", action === "status" ? "Use GET" : "Use POST", 405)
    if (action !== "status" && !valid_csrf(request, session)) return api_error("forbidden", "Use the owner session and CSRF headers", 403)
    if (!env.PERSONAL_ORIGIN || !env.ORIGIN_HMAC_SECRET) return api_error("api_offline", "API supervisor is not configured", 503)
    let body: Record<string, unknown> = {}
    if (action !== "status") {
        if (!request.headers.get("content-type")?.startsWith("application/json")) return api_error("unsupported_media_type", "Use JSON", 415)
        const reader = request.body?.getReader()
        if (!reader) return api_error("invalid_request", "API command body required", 400)
        const chunks: Uint8Array[] = []; let size = 0
        try {
            while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 4096) return api_error("body_too_large", "API command exceeds 4 KiB", 413); chunks.push(part.value) }
            const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
            body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
            if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid command")
        } catch { return api_error("invalid_request", "Invalid API command JSON", 400) }
        finally { await reader.cancel() }
        if (action === "deploy") {
            if (Object.keys(body).some(key => key !== "source") || typeof body.source !== "string" || body.source.length > 2048 || !body.source.endsWith(".auto.js") || !/^(\/|[a-zA-Z]:[\\/])/.test(body.source) || /[\0\r\n]/.test(body.source)) return api_error("invalid_source", "Choose an absolute .auto.js path on the personal server", 400)
        } else if (Object.keys(body).some(key => !["id", "version"].includes(key)) || !valid_subdomain_id(body.id) || !Number.isInteger(body.version) || Number(body.version) < 1 || Number(body.version) > 9999) return api_error("invalid_version", "Choose an API id and version", 400)
    }
    try {
        const origin = new URL(env.PERSONAL_ORIGIN)
        if (origin.origin !== env.PERSONAL_ORIGIN || origin.username || origin.password || origin.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(origin.hostname)) throw new Error("Invalid origin")
        const target = new URL(`/custom-api/_/${action}`, origin), text = JSON.stringify(body)
        const headers = await sign_origin(new Request(target, { method: "POST", body: text }), env.ORIGIN_HMAC_SECRET, "api-admin")
        add_access_headers(headers, env); headers.set("content-type", "application/json")
        const response = await upstream(new Request(target, { method: "POST", headers, body: text, redirect: "manual", signal: AbortSignal.timeout(20000) }))
        if (response.status !== 200) return api_error("command_failed", "API supervisor rejected the command; check its private audit log", response.status === 400 ? 400 : 503)
        return Response.json({ data: await response.json() }, { headers: { "cache-control": "no-store", "referrer-policy": "no-referrer", vary: "Cookie" } })
    } catch { return api_error("api_offline", "API supervisor is unavailable", 503) }
}
