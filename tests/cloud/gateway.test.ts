/* Edge routing policy and private signed envelopes; the origin enforces API-specific policy independently. */
import { test } from "node:test"
import assert from "node:assert/strict"
import { custom_api_route, versioned_target } from "../../cloud/gateway.ts"
import { verify_origin } from "../../shared/sign.ts"
import type { worker_env } from "../../cloud/router/index.ts"

test("custom gateway accepts only versioned DNS IDs and preserves encoded path segments for one server decode", () => {
    assert.deepEqual(versioned_target("/api/sample/v12/a%20b"), { id: "sample", version: 12, path: "/a%20b" })
    for (const path of ["/api/_/v1", "/api/api/v1", "/api/sample/v0", "/api/sample/v10000", "/api/sample", "/api/sample/v1x", "/api/a_b/v1"]) assert.equal(versioned_target(path), null)
})
test("manifest matching strips cookies, signs actor metadata and keeps reply security headers authoritative", async () => {
    const env = { DOMAIN: "example.com", PAGES_ORIGIN: "https://pages.example.com", PERSONAL_ORIGIN: "https://api-origin.example.com", ORIGIN_HMAC_SECRET: "k".repeat(40), ACCESS_CLIENT_ID: "access-id", ACCESS_CLIENT_SECRET: "access-secret" }
    const bodies: any[] = [], seen = new Map<string, number>()
    const upstream = async (request: Request) => {
        assert(await verify_origin(request, env.ORIGIN_HMAC_SECRET, seen))
        assert.equal(request.headers.get("cookie"), null); assert.equal(request.headers.get("authorization"), null)
        assert.equal(request.headers.get("cf-access-client-secret"), "access-secret")
        const body = await request.json() as any; bodies.push(body)
        if (request.url.endsWith("/manifest")) return Response.json({ id: "sample", version: 1, access: "public", routes: [{ method: "QUERY", path: "/:name" }] })
        assert.equal(body.path, "/hello%20world"); assert.equal(body.actor.owner, false); assert.equal(body.headers.authorization, "Bearer token")
        return Response.json({ status: 201, headers: { "set-cookie": "evil=1", "x-content-type-options": "off", "x-api-result": "ok", "deprecation": "true" }, body: { data: body.query } })
    }
    const response = await custom_api_route(new Request("https://example.com/api/sample/v1/hello%20world?x=1&x=2", { method: "QUERY", headers: { authorization: "Bearer token", cookie: "unrelated=secret", "content-type": "application/json" }, body: "{}" }), env, upstream)
    assert.equal(response.status, 201); assert.equal(response.headers.get("set-cookie"), null); assert.equal(response.headers.get("x-content-type-options"), "nosniff"); assert.equal(response.headers.get("x-api-result"), "ok")
    assert.deepEqual((await response.json() as any).data, { x: ["1", "2"] })
    assert.equal(bodies.length, 2)
    assert.equal((await custom_api_route(new Request("https://example.com/api/sample/v1/a%2Fb"), env, upstream)).status, 400)
})
test("cookie-authenticated writes retain CSRF protection and do not send a forged owner to the origin", async () => {
    const env: worker_env = { DOMAIN: "example.com", PAGES_ORIGIN: "https://pages.example.com", PERSONAL_ORIGIN: "https://private-api-origin.example.com", ORIGIN_HMAC_SECRET: "k".repeat(40), DB: { prepare() { return { bind() { return this }, async first<T>() { return { subject: "one", email: "one@example.com", name: "One", owner_subject: "one", last_seen: Date.now(), passkey_count: 1, stepup_verified: null } as T }, async all<T>() { return { results: [] as T[] } }, async run() {} } } } }
    const cookie = `__Host-jazu_session=${"r".repeat(43)}`
    const denied = await custom_api_route(new Request("https://example.com/api/sample/v1/", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: "{}" }), env, async () => { throw new Error("must not call origin") })
    assert.equal(denied.status, 403)
    const locked = await custom_api_route(new Request("https://example.com/api/sample/v1/", { headers: { cookie } }), env, async request => {
        if (request.url.endsWith("/manifest")) return Response.json({ id: "sample", version: 1, access: "owner", routes: [{ method: "GET", path: "/" }] })
        const body = await request.json() as any
        assert.equal(body.actor.owner, false)
        return Response.json({ status: 404, headers: {}, body: { error: { code: "not_found" } } })
    })
    assert.equal(locked.status, 404)
    const error = await custom_api_route(new Request("https://example.com/api/sample/v1/", { method: "POST", headers: { "content-type": "text/plain" }, body: "not JSON" }), env)
    assert.equal(error.status, 415)
})
