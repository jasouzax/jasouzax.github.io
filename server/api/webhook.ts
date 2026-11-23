/* Bounded outbound JSON webhooks with stable delivery keys, optional HMAC, retries and durable outcomes. */
import { createHmac, randomUUID } from "node:crypto"
import { setTimeout } from "node:timers/promises"
import type { Api_Idempotency } from "./idempotency.ts"
import { data_json } from "./data.ts"
import { response_bytes } from "./client.ts"
import { Api_Error } from "./output.ts"
type Send_Options = { key?: string, headers?: Record<string, string>, signature?: { secret: string, header?: string }, attempts?: number, timeout_ms?: number, signal?: AbortSignal }
type Delivery = { status: number, body: unknown }
export class Api_Webhooks {
    readonly requests: Api_Idempotency
    constructor(requests: Api_Idempotency) { this.requests = requests }
    async send(destination: string, payload: unknown, options: Send_Options = {}): Promise<Delivery> {
        const url = new URL(destination), key = options.key ?? randomUUID(), attempts = options.attempts ?? 3, timeout = options.timeout_ms ?? 8000
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || !Number.isInteger(attempts) || attempts < 1 || attempts > 3 || !Number.isInteger(timeout) || timeout < 1 || timeout > 8000) throw new Error("Invalid webhook URL or retry settings")
        const text = data_json(payload), headers = new Headers(options.headers)
        headers.set("content-type", "application/json"); headers.set("idempotency-key", key)
        if (options.signature) headers.set(options.signature.header ?? "x-hook-signature", `sha256=${createHmac("sha256", options.signature.secret).update(text).digest("hex")}`)
        const acquired = this.requests.begin("outbound", `POST:${url.href}`, key, payload)
        if (acquired.cached) {
            const cached = acquired.cached.body as any
            if (cached.error) throw new Api_Error(cached.error.code, cached.error.message, 502)
            return cached.data
        }
        try {
            for (let attempt = 0; attempt < attempts; attempt++) {
                const deadline = AbortSignal.timeout(timeout), signal = options.signal ? AbortSignal.any([deadline, options.signal]) : deadline
                let response: Response
                try { response = await fetch(url, { method: "POST", headers, body: text, signal, redirect: "manual" }) }
                catch (error) { if (options.signal?.aborted || attempt + 1 === attempts) throw error; await setTimeout(100 * 2 ** attempt, undefined, { signal: options.signal }); continue }
                if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); throw new Api_Error("webhook_redirect", "Webhook delivery refused a redirect", 502) }
                if ((response.status === 429 || response.status >= 500) && attempt + 1 < attempts) { await response.body?.cancel(); await setTimeout(100 * 2 ** attempt, undefined, { signal: options.signal }); continue }
                const bytes = await response_bytes(response, 65536), raw = new TextDecoder().decode(bytes)
                let body: unknown = raw
                try { body = raw ? JSON.parse(raw) : null } catch { /* Webhook receivers may return plain text. */ }
                const result = { status: response.status, body }
                this.requests.finish(acquired.key, { status: 200, headers: {}, body: { data: result } })
                this.requests.store.audit("webhook", { id: acquired.key, status: result.status })
                return result
            }
            throw new Error("Webhook delivery failed")
        } catch (error) {
            const code = error instanceof Api_Error ? error.code : "webhook_failed", message = error instanceof Api_Error ? error.message : "Webhook delivery failed"
            this.requests.finish(acquired.key, { status: 502, headers: {}, body: { error: { code, message } } })
            this.requests.store.audit("webhook", { id: acquired.key, status: 502, code })
            throw new Api_Error(code, message, 502)
        }
    }
}
