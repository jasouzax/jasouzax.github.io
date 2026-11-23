/* Server-owned API policy and JSON handlers inside one dedicated script process; owner scripts are trusted OS code. */
import Ajv, { type ValidateFunction } from "ajv"
import { createHash, timingSafeEqual } from "node:crypto"
import { join } from "node:path"
import { valid_subdomain_id } from "../../shared/content/ids.ts"
import { api_failure, api_limit, api_methods, type Api_Call, type Api_Config, type Api_Manifest, type Api_Method, type Api_Result, type Route_Config } from "../../shared/api/types.ts"
import { match_route, route_order, route_segments } from "../../shared/api/routes.ts"
import { Api_Store } from "./store.ts"
import { Api_Output } from "./output.ts"

export type Api_Context = { body: unknown, params: Record<string, string>, query: Api_Call["query"], headers: Api_Call["headers"], actor: Api_Call["actor"], request_id: string, signal: AbortSignal }
type Handler = (context: Api_Context) => unknown | Promise<unknown>
type Route = { method: Api_Method, path: string, segments: string[], options: Route_Config, handler: Handler, checks: Partial<Record<"body" | "params" | "query" | "response", ValidateFunction>> }
export function validate_config(config: Api_Config): void {
    if (!config || !valid_subdomain_id(config.id) || !Number.isSafeInteger(config.version) || config.version < 1 || config.version > 9999) throw new Error("API requires a valid id and integer version 1..9999")
    if (config.access !== undefined && !["owner", "public", "token"].includes(config.access)) throw new Error("Invalid API access")
    if (config.response !== undefined && ![true, false, "strict", "log"].includes(config.response)) throw new Error("Invalid response policy")
    if (config.tokens && (!Array.isArray(config.tokens) || config.tokens.some(token => !/^[a-f0-9]{64}$/.test(token.hash) || token.unlimited !== undefined && typeof token.unlimited !== "boolean" || !Array.isArray(token.scopes) || token.scopes.some(scope => typeof scope !== "string" || scope.length > 100)))) throw new Error("Service tokens require SHA-256 hashes and scopes")
    if (config.rate && (!Number.isInteger(config.rate.requests) || config.rate.requests < 1 || !Number.isInteger(config.rate.seconds) || config.rate.seconds < 1 || config.rate.seconds > 86400)) throw new Error("Invalid API rate")
    if (config.timeout_ms !== undefined && (!Number.isInteger(config.timeout_ms) || config.timeout_ms < 1 || config.timeout_ms > 30000)) throw new Error("Timeout must be 1..30000 ms")
    if (config.deprecated && (!/^\d{4}-\d{2}-\d{2}$/.test(config.deprecated) || !Number.isFinite(Date.parse(config.deprecated)) || new Date(config.deprecated).toISOString().slice(0, 10) !== config.deprecated)) throw new Error("Deprecation requires an ISO date")
    if (config.secrets && (!Array.isArray(config.secrets) || config.secrets.some(name => !/^[A-Z][A-Z0-9_]{0,127}$/.test(name)))) throw new Error("Invalid secret names")
}
export class Runtime_API {
    readonly config: Api_Config
    readonly store: Api_Store
    readonly routes: Route[] = []
    readonly validator = new Ajv({ strict: true, ownProperties: true, allErrors: false })
    readonly buckets = new Map<string, { count: number, expires: number }>()
    constructor(config: Api_Config, directory: string) {
        validate_config(config)
        this.config = config
        for (const name of config.secrets ?? []) if (!process.env[name]) throw new Error(`Required secret ${name} is missing`)
        Object.defineProperties(config, { id: { value: config.id, writable: false, configurable: false }, version: { value: config.version, writable: false, configurable: false } })
        this.store = new Api_Store(join(directory, `.jazu-api-${config.id}.sqlite`))
    }
    secret(name: string): string { if (!this.config.secrets?.includes(name) || !process.env[name]) throw new Error(`Secret ${name} is unavailable`); return process.env[name]! }
    reply(value: unknown, status = 200, headers: Record<string, string> = {}): Api_Output { return new Api_Output(value, status, headers) }
    seal(): void { Object.freeze(this.routes) }
    manifest(): Api_Manifest { return { id: this.config.id, version: this.config.version, access: this.config.access ?? "owner", ...(this.config.deprecated ? { deprecated: this.config.deprecated } : {}), routes: this.routes.map(({ method, path }) => ({ method, path })) } }
    route(method: Api_Method, path: string, options: Route_Config | Handler, handler?: Handler): this {
        if (!api_methods.includes(method)) throw new Error("Unsupported API method")
        const segments = route_segments(path, true), config = typeof options === "function" ? {} : options, run = typeof options === "function" ? options : handler
        if (this.routes.length >= 256) throw new Error("An API may declare at most 256 routes")
        const shape = (parts: string[]) => parts.map(part => part.startsWith(":") ? ":" : part.startsWith("*") ? "*" : part).join("/")
        if (!run || this.routes.some(route => route.method === method && shape(route.segments) === shape(segments))) throw new Error("Missing handler or ambiguous API route")
        const checks: Route["checks"] = {}
        for (const key of ["body", "params", "query", "response"] as const) if (config[key]) checks[key] = this.validator.compile(config[key]!)
        if (config.scopes && (!Array.isArray(config.scopes) || config.scopes.some(scope => typeof scope !== "string" || !scope))) throw new Error("Invalid route scopes")
        this.routes.push({ method, path, segments, options: config, handler: run, checks }); this.routes.sort((a, b) => route_order(a.segments, b.segments))
        return this
    }
    get(path: string, options: Route_Config | Handler, handler?: Handler): this { return this.route("GET", path, options, handler) }
    post(path: string, options: Route_Config | Handler, handler?: Handler): this { return this.route("POST", path, options, handler) }
    put(path: string, options: Route_Config | Handler, handler?: Handler): this { return this.route("PUT", path, options, handler) }
    patch(path: string, options: Route_Config | Handler, handler?: Handler): this { return this.route("PATCH", path, options, handler) }
    delete(path: string, options: Route_Config | Handler, handler?: Handler): this { return this.route("DELETE", path, options, handler) }
    query(path: string, options: Route_Config | Handler, handler?: Handler): this { return this.route("QUERY", path, options, handler) }
    async dispatch(call: Api_Call): Promise<Api_Result> {
        const fail = (code: string, message: string, status: number) => api_failure(code, message, status, call.request_id)
        let status = 500
        try {
            validate_config(this.config)
            const bearer = /^Bearer ([^\s]{1,2048})$/i.exec(call.headers.authorization ?? "")?.[1]
            const hash = bearer ? createHash("sha256").update(bearer).digest("hex") : ""
            const token = this.config.tokens?.find(token => hash && timingSafeEqual(Buffer.from(token.hash, "hex"), Buffer.from(hash, "hex")))
            const access = this.config.access ?? "owner"
            if (!call.actor.owner && (access === "owner" || access === "token" && !token)) { status = 404; return fail("not_found", "API unavailable", status) }
            const segments = route_segments(call.path)
            const method = call.method === "HEAD" && !this.routes.some(route => route.method === "HEAD" && match_route(route.segments, segments)) ? "GET" : call.method
            const route = this.routes.find(route => route.method === method && match_route(route.segments, segments))
            if (!route) { status = this.routes.some(route => match_route(route.segments, segments)) ? 405 : 404; return fail(status === 405 ? "method_not_allowed" : "not_found", "API route unavailable", status) }
            if (!call.actor.owner && route.options.scopes?.some(scope => !token?.scopes.includes(scope))) { status = 403; return fail("insufficient_scope", "Required service-token scope is missing", status) }
            if (!call.actor.owner && !token?.unlimited && this.config.rate) {
                const now = Date.now(), identity = hash || call.ip || "anonymous", previous = this.buckets.get(identity)
                for (const [key, bucket] of this.buckets) if (bucket.expires <= now) this.buckets.delete(key)
                const bucket = previous && previous.expires > now ? previous : { count: 0, expires: now + this.config.rate.seconds * 1000 }
                if (bucket.count >= this.config.rate.requests || !this.buckets.has(identity) && this.buckets.size >= 10000) { status = 429; return fail("rate_limited", "API request limit reached", status) }
                bucket.count++; this.buckets.set(identity, bucket)
            }
            const context: Api_Context = { body: call.body, query: call.query, params: match_route(route.segments, segments)!, headers: Object.fromEntries(Object.entries(call.headers).filter(([name]) => !["authorization", "cookie"].includes(name))), actor: call.actor, request_id: call.request_id, signal: AbortSignal.timeout(this.config.timeout_ms ?? 30000) }
            for (const key of ["body", "query", "params"] as const) if (route.checks[key] && !route.checks[key]!(context[key])) { status = 400; return fail("invalid_request", `${key} does not match the declared schema`, status) }
            let timer: ReturnType<typeof setTimeout> | undefined
            let value: unknown
            try { value = await Promise.race([Promise.resolve().then(() => route.handler(context)), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("handler_timeout")), this.config.timeout_ms ?? 30000) })]) }
            finally { clearTimeout(timer) }
            const output = value instanceof Api_Output ? value : null
            if (output) value = output.value
            value ??= null
            const check = this.config.response ?? "log"
            if (check && route.checks.response && !route.checks.response(value)) {
                this.store.audit("response_schema", { request_id: call.request_id, route: route.path })
                if (check === true || check === "strict") { status = 502; return fail("invalid_response", "API response does not match its schema", status) }
            }
            const body = { data: value ?? null, meta: { request_id: call.request_id } }, encoded = JSON.stringify(body)
            if (Buffer.byteLength(encoded) > api_limit) { status = 502; return fail("response_too_large", "API response exceeds the transport limit", status) }
            status = output?.status ?? 200
            return { status, headers: { "cache-control": "no-store", ...Object.fromEntries(Object.entries(output?.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value])), ...(this.config.deprecated ? { deprecation: `@${Date.parse(this.config.deprecated) / 1000}`, sunset: new Date(this.config.deprecated).toUTCString() } : {}) }, body }
        } catch (error) { status = (error as Error).message === "handler_timeout" ? 504 : error instanceof URIError || /API path/.test((error as Error).message) ? 400 : 500; return fail(status === 504 ? "timeout" : status === 400 ? "bad_path" : "internal", status === 504 ? "API handler timed out" : status === 400 ? "Invalid API path" : "API handler failed", status) }
        finally { this.store.audit("request", { request_id: call.request_id, method: call.method, path: call.path, status }) }
    }
}
