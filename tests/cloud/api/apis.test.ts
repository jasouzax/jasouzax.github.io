import { test } from "node:test"
import assert from "node:assert/strict"
import { apis_route } from "../../../cloud/api/apis.ts"
import { auth_hash } from "../../../cloud/api/auth.ts"
import { verify_origin } from "../../../shared/sign.ts"
import type { worker_env } from "../../../cloud/router/index.ts"

function fixture(owner = true, locked = false): worker_env {
    return { DOMAIN: "example.com", PAGES_ORIGIN: "https://pages.example.com", PERSONAL_ORIGIN: "https://personal-server.example.com", ORIGIN_HMAC_SECRET: "k".repeat(40), DB: { prepare() { return { bind() { return this }, async first<T>() { return { subject: "owner", email: "owner@example.com", name: "Owner", owner_subject: owner ? "owner" : null, last_seen: Date.now(), passkey_count: locked ? 1 : 0, stepup_verified: null } as T }, async all<T>() { return { results: [] as T[] } }, async run() {} } } } }
}
test("API administration requires a current owner, CSRF on writes and bounded explicit commands", async () => {
    const env = fixture(), token = "r".repeat(43), cookie = `__Host-jazu_session=${token}`, csrf = await auth_hash(`csrf\n${token}`)
    const calls: Request[] = [], seen = new Map<string, number>()
    const upstream: typeof fetch = async input => {
        const request = input as Request; calls.push(request)
        assert.equal(request.headers.get("cookie"), null); assert.equal(request.headers.get("authorization"), null)
        assert.equal(request.headers.get("x-jazu-client"), "api-admin")
        assert(await verify_origin(request, env.ORIGIN_HMAC_SECRET!, seen))
        return Response.json(request.url.endsWith("status") ? [{ id: "counter", version: 1, online: true }] : { stopped: true })
    }
    const get = () => new Request("https://example.com/api/_/apis", { headers: { cookie } })
    const post = (body: unknown, action = "stop") => new Request(`https://example.com/api/_/apis/${action}`, { method: "POST", headers: { cookie, origin: "https://example.com", "x-jazu-work": "1", "x-jazu-csrf": csrf, "content-type": "application/json" }, body: JSON.stringify(body) })
    assert.equal((await apis_route(new Request(get().url), env, upstream)).status, 404)
    assert.equal((await apis_route(get(), fixture(false), upstream)).status, 404)
    assert.equal((await apis_route(get(), fixture(true, true), upstream)).status, 404)
    assert.equal(calls.length, 0)
    const status = await apis_route(get(), env, upstream)
    assert.equal(status.headers.get("cache-control"), "no-store"); assert.equal((await status.json() as any).data[0].id, "counter")
    assert.equal((await apis_route(post({ id: "counter", version: 1 }), env, upstream)).status, 200)
    const forged = post({ id: "counter", version: 1 }); forged.headers.delete("x-jazu-csrf")
    assert.equal((await apis_route(forged, env, upstream)).status, 403)
    assert.equal((await apis_route(post({ id: "_", version: 1 }), env, upstream)).status, 400)
    assert.equal((await apis_route(post({ id: "counter", version: 1, source: "/tmp/other.auto.js" }), env, upstream)).status, 400)
    assert.equal((await apis_route(post({ source: "relative.auto.js" }, "deploy"), env, upstream)).status, 400)
    assert.equal((await apis_route(post({ source: "/tmp/counter.auto.js" }, "deploy"), env, upstream)).status, 200)
    assert.equal((await apis_route(post({ source: "x".repeat(5000) }, "deploy"), env, upstream)).status, 413)
    assert.equal(calls.length, 3)
})
