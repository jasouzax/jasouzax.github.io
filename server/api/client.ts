/* JSON API client with bounded responses and redirect refusal, so service tokens never follow a redirect. */
import { api_limit, api_methods, type Api_Method } from "../../shared/api/types.ts"
import { valid_subdomain_id } from "../../shared/content/ids.ts"
import { route_segments } from "../../shared/api/routes.ts"
import { Api_Error } from "./output.ts"
export async function response_bytes(response: Response, limit = api_limit + 16384): Promise<Uint8Array> {
    const reader = response.body?.getReader()
    if (!reader) return new Uint8Array()
    const chunks: Uint8Array[] = []; let length = 0
    try { while (true) { const next = await reader.read(); if (next.done) break; length += next.value.length; if (length > limit) throw new Api_Error("response_too_large", "Upstream response exceeded the API limit", 502); chunks.push(next.value) } }
    finally { await reader.cancel().catch(() => {}) }
    const bytes = new Uint8Array(length); let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
    return bytes
}
type Client_Options = { origin: string, token?: string, timeout_ms?: number }
type Call_Options = { key?: string, query?: Record<string, string | string[]>, headers?: Record<string, string>, signal?: AbortSignal }
export class Api_Client {
    readonly id: string
    readonly version: number
    readonly options: Client_Options
    readonly origin: string
    constructor(id: string, version: number, options: Client_Options) {
        const url = new URL(options.origin)
        if (!valid_subdomain_id(id) || !Number.isInteger(version) || version < 1 || version > 9999 || !["https:", "http:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("API.open requires an API id/version and HTTP(S) origin")
        this.id = id; this.version = version; this.options = options; this.origin = url.origin
    }
    async request(method: Api_Method, path: string, body?: unknown, options: Call_Options = {}): Promise<any> {
        route_segments(path)
        if (/[?#]/.test(path) || !api_methods.includes(method)) throw new Error("Use a path and separate query parameters")
        const url = new URL(`/api/${this.id}/v${this.version}${path}`, this.origin)
        for (const [key, value] of Object.entries(options.query ?? {})) for (const part of Array.isArray(value) ? value : [value]) url.searchParams.append(key, part)
        const headers = new Headers(options.headers)
        headers.set("accept", "application/json")
        if (this.options.token) headers.set("authorization", `Bearer ${this.options.token}`)
        if (options.key) headers.set("idempotency-key", options.key)
        const text = body === undefined ? undefined : JSON.stringify(body)
        if (text && Buffer.byteLength(text) > api_limit) throw new Api_Error("body_too_large", "API client body exceeds the transport limit", 413)
        if (text !== undefined) headers.set("content-type", "application/json")
        const deadline = AbortSignal.timeout(this.options.timeout_ms ?? 35000), signal = options.signal ? AbortSignal.any([deadline, options.signal]) : deadline
        const response = await fetch(url, { method, headers, body: text, signal, redirect: "manual" })
        if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); throw new Api_Error("unexpected_redirect", "API client refused a redirect", 502) }
        if (method === "HEAD" || response.status === 204) { await response.body?.cancel(); return null }
        let value: any
        try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await response_bytes(response))) }
        catch (error) { if (error instanceof Api_Error) throw error; throw new Api_Error("invalid_response", "API client expected a JSON envelope", 502) }
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Api_Error("invalid_response", "API client expected a JSON envelope", 502)
        if (!response.ok || value.error) throw new Api_Error(typeof value.error?.code === "string" ? value.error.code : "upstream_error", typeof value.error?.message === "string" ? value.error.message : "API request failed", response.status >= 400 ? response.status : 502)
        if (!Object.hasOwn(value, "data")) throw new Api_Error("invalid_response", "API client expected a JSON data envelope", 502)
        return value.data
    }
    get(path = "/", options?: Call_Options): Promise<any> { return this.request("GET", path, undefined, options) }
    post(path: string, body?: unknown, options?: Call_Options): Promise<any> { return this.request("POST", path, body, options) }
    put(path: string, body?: unknown, options?: Call_Options): Promise<any> { return this.request("PUT", path, body, options) }
    patch(path: string, body?: unknown, options?: Call_Options): Promise<any> { return this.request("PATCH", path, body, options) }
    delete(path: string, body?: unknown, options?: Call_Options): Promise<any> { return this.request("DELETE", path, body, options) }
    query(path: string, body?: unknown, options?: Call_Options): Promise<any> { return this.request("QUERY", path, body, options) }
}
