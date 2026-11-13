/*
 * Public Smart HTTP reads prefer the XML-configured HTTPS provider, then the personal Git backend.
 * External requests never receive visitor/server credentials. Negotiation bodies are bounded and replayable;
 * pack responses stream without buffering. Pi discovery redirects stay on this website and pin subsequent
 * fetch requests to the Pi so provider recovery cannot switch repositories halfway through negotiation.
 */
import type { worker_env } from "./worker.ts"
import { api_error } from "./security.ts"

type Fetcher = (request: Request) => Promise<Response>
const negotiation_limit = 8 * 1024 * 1024

function read_origin(env: worker_env, id: string): URL | null {
    try {
        const origins = JSON.parse(env.PROJECT_CLONE_ORIGINS ?? "{}")
        if (!origins || !Object.hasOwn(origins, id) || typeof origins[id] !== "string") return null
        const url = new URL(origins[id])
        if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash || url.pathname === "/") return null
        if (url.hostname === env.DOMAIN || url.hostname.endsWith(`.${env.DOMAIN}`) || url.hostname === new URL(env.PERSONAL_ORIGIN ?? "https://invalid.example").hostname) return null
        return url
    } catch { return null }
}

async function negotiation_body(request: Request): Promise<ArrayBuffer> {
    if (Number(request.headers.get("content-length") ?? 0) > negotiation_limit) throw new RangeError("Git negotiation request exceeds 8 MiB")
    const reader = request.body?.getReader()
    if (!reader) return new ArrayBuffer(0)
    const chunks: Uint8Array[] = []
    let length = 0
    for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        length += value.byteLength
        if (length > negotiation_limit) { await reader.cancel(); throw new RangeError("Git negotiation request exceeds 8 MiB") }
        chunks.push(value)
    }
    const body = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength }
    return body.buffer
}

function pi_discovery(request: Request, id: string): Response {
    const target = new URL(`/projects/${id}/_git/pi/info/refs?service=git-upload-pack`, request.url)
    return new Response(null, { status: 307, headers: { location: target.href, "cache-control": "no-store" } })
}

async function external_read(request: Request, origin: URL, operation: string, body: ArrayBuffer | undefined, upstream: Fetcher): Promise<Response | null> {
    let target = new URL(`${origin.href.replace(/\/+$/, "")}/${operation}${operation === "info/refs" ? "?service=git-upload-pack" : ""}`)
    const headers = new Headers()
    for (const name of ["content-type", "content-encoding", "git-protocol", "accept"]) if (request.headers.has(name)) headers.set(name, request.headers.get(name)!)
    for (let redirects = 0; redirects <= 3; redirects++) {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 15000)
        let response: Response
        try {
            response = await upstream(new Request(target, { method: request.method, headers, body, redirect: "manual", signal: AbortSignal.any([request.signal, controller.signal]) }))
        } finally { clearTimeout(timer) }
        if ([301, 302, 307, 308].includes(response.status)) {
            const location = response.headers.get("location")
            void response.body?.cancel().catch(() => {})
            if (!location) return null
            const next = new URL(location, target)
            if (next.origin !== origin.origin || next.username || next.password || next.hash || !next.pathname.endsWith(`/${operation}`)) return null
            target = next
            continue
        }
        const expected = operation === "info/refs" ? "application/x-git-upload-pack-advertisement" : "application/x-git-upload-pack-result"
        if (response.status !== 200 || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== expected) {
            void response.body?.cancel().catch(() => {})
            return null
        }
        const output = new Headers(response.headers)
        output.delete("set-cookie")
        output.set("cache-control", "no-store")
        return new Response(response.body, { status: 200, headers: output })
    }
    return null
}

export async function public_git_read(request: Request, env: worker_env, id: string, operation: string, upstream: Fetcher, personal: Fetcher): Promise<Response> {
    const method = operation === "info/refs" ? "GET" : "POST"
    if (request.method !== method) return api_error("method_not_allowed", `Use ${method}`, 405)
    let body: ArrayBuffer | undefined
    if (method === "POST") {
        try { body = await negotiation_body(request) }
        catch (error) { return api_error("bad_git_request", error instanceof Error ? error.message : "Invalid Git request", error instanceof RangeError ? 413 : 400) }
    }
    const origin = read_origin(env, id)
    if (origin) {
        try {
            const response = await external_read(request, origin, operation, body, upstream)
            if (response) return response
        } catch { /* An unavailable provider falls back before any response bytes are returned. */ }
    }
    if (method === "GET") return pi_discovery(request, id)
    return personal(new Request(request.url, { method, headers: request.headers, body, signal: request.signal }))
}
