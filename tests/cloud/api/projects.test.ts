/* Origin forwarding never exposes browser cookies or accepts an unprotected hook request. */
import { test } from "node:test"
import assert from "node:assert/strict"
import { projects_route } from "../../../cloud/api/projects.ts"
import { auth_hash } from "../../../cloud/api/auth.ts"
import { verify_origin } from "../../../shared/sign.ts"
import type { worker_env } from "../../../cloud/router/index.ts"

test("project hooks require owner CSRF and forward a signed empty request", async () => {
    const token = "r".repeat(43), csrf = await auth_hash(`csrf\n${token}`), secret = "synthetic-origin-secret-at-least-32-characters"
    const env = { PERSONAL_ORIGIN: "https://origin.example.com", ORIGIN_HMAC_SECRET: secret, DB: { prepare() { return { bind() { return this }, async first() { return { subject: "owner", email: "owner@example.com", name: "Owner", last_seen: Date.now(), owner_subject: "owner" } } } } } } as unknown as worker_env
    const headers = { cookie: `__Host-jazu_session=${token}`, origin: "https://example.com", "x-jazu-csrf": csrf, "x-jazu-work": "1" }
    const url = "https://example.com/api/_/projects/example/publish"
    assert.equal((await projects_route(new Request(url, { method: "POST", headers: { ...headers, "x-jazu-csrf": "wrong" } }), env)).status, 403)
    assert.equal((await projects_route(new Request(url), env)).status, 405)
    let calls = 0
    const upstream = (async (request: Request) => {
        calls++
        assert.equal(request.url, "https://origin.example.com/projects/example/publish")
        assert.equal(request.headers.get("cookie"), null)
        assert.equal(request.headers.get("x-jazu-csrf"), null)
        assert(await verify_origin(request, secret, new Map()))
        return Response.json({ jobs: [] }, { status: 202 })
    }) as typeof fetch
    assert.equal((await projects_route(new Request(url, { method: "POST", headers }), env, upstream)).status, 202)
    assert.equal(calls, 1)
})
