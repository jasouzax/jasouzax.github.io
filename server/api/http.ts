/* HMAC-authenticated transport: the gateway carries identity in the signed JSON body; only local operators deploy code. */
import type { IncomingMessage } from "node:http"
import { api_limit, api_methods, api_failure, type Api_Call } from "../../shared/api/types.ts"
import { verify_origin } from "../../shared/sign.ts"
import { valid_subdomain_id } from "../../shared/content/ids.ts"
import type { Api_Manager } from "./manager.ts"

async function read_body(incoming: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = []; let size = 0, failed = false
        incoming.on("error", reject)
        incoming.on("data", chunk => { if (failed) return; size += chunk.length; if (size > api_limit + 16384) { failed = true; chunks.length = 0; reject(new Error("body_limit")); return }; chunks.push(Buffer.from(chunk)) })
        incoming.on("end", () => { if (!failed) resolve(Buffer.concat(chunks).toString("utf8")) })
    })
}
export async function api_transport(incoming: IncomingMessage, manager: Api_Manager, secret: string, seen: Map<string, number>): Promise<Response> {
    const fail = (code: string, message: string, status: number) => Response.json(api_failure(code, message, status).body, { status, headers: { "cache-control": "no-store" } })
    if (incoming.method !== "POST") return fail("method_not_allowed", "Use signed POST transport", 405)
    const client = incoming.headers["x-jazu-client"]
    if (!["api-gateway", "api-admin"].includes(String(client))) return fail("unauthorized", "Signed API transport required", 401)
    try {
        const headers = new Headers()
        for (const [name, value] of Object.entries(incoming.headers)) if (name.startsWith("x-jazu-") && typeof value === "string") headers.set(name, value)
        const text = await read_body(incoming), request = new Request(`http://127.0.0.1${incoming.url}`, { method: "POST", headers, body: text })
        if (!await verify_origin(request, secret, seen)) return fail("unauthorized", "Invalid API transport signature", 401)
        const path = new URL(request.url).pathname, body = JSON.parse(text)
        if (path === "/custom-api/_/manifest") {
            const manifest = manager.manifests().find(value => value.id === body.id && value.version === body.version)
            return manifest ? Response.json(manifest, { headers: { "cache-control": "no-store" } }) : fail("not_found", "API unavailable", 404)
        }
        if (client === "api-admin") {
            if (path === "/custom-api/_/status") return Response.json([...manager.releases].map(([key, release]) => ({ ...release, key, online: manager.active.has(key) })))
            if (path === "/custom-api/_/deploy" && typeof body.source === "string") return Response.json(await manager.deploy(body.source))
            if (valid_subdomain_id(body.id) && Number.isInteger(body.version) && body.version > 0 && body.version <= 9999) {
                if (path === "/custom-api/_/rollback") return Response.json(await manager.rollback(body.id, body.version))
                if (path === "/custom-api/_/stop") { await manager.stop(body.id, body.version); return Response.json({ stopped: true }) }
            }
            return fail("invalid_command", "Unknown API management command", 400)
        }
        const match = /^\/custom-api\/([a-z0-9-]+)\/v([1-9][0-9]{0,3})$/.exec(path)
        if (!match || !valid_subdomain_id(match[1])) return fail("not_found", "Unknown API transport route", 404)
        const call = body as Api_Call
        if (!call || !api_methods.includes(call.method as any) || typeof call.path !== "string" || typeof call.ip !== "string" || call.ip.length > 128 || typeof call.request_id !== "string" || call.request_id.length > 100 || !call.actor || typeof call.actor.owner !== "boolean" || !call.query || typeof call.query !== "object" || !call.headers || typeof call.headers !== "object" || Object.entries(call.headers).some(([key, value]) => typeof value !== "string" || !["authorization", "content-type", "accept", "idempotency-key"].includes(key))) return fail("invalid_request", "Invalid API call envelope", 400)
        return Response.json(await manager.call(match[1], Number(match[2]), call), { headers: { "cache-control": "no-store" } })
    } catch (error) { return fail((error as Error).message === "body_limit" ? "body_too_large" : "invalid_request", (error as Error).message === "body_limit" ? "API body exceeds the transport limit" : client === "api-admin" ? (error as Error).message : "Invalid API request", (error as Error).message === "body_limit" ? 413 : 400) }
}
