/* Fixed API namespace and reserved gateway dispatch; no remote services are contacted. */
import { test } from "node:test"
import assert from "node:assert/strict"
import worker, { route, type worker_env } from "../../../cloud/router/index.ts"
import { gateway_target } from "../../../cloud/api/server.ts"

const env: worker_env = { DOMAIN: "example.com", PAGES_ORIGIN: "https://pages.example.net" }

test("system capability and session discovery use fixed IDs", async () => {
    const health = await route(new Request("https://example.com/api/_/health"), env)
    assert.equal(health.status, 200)
    assert.equal((await health.json()).status, "ok")
    assert.equal(health.headers.get("cache-control"), "no-store")
    const head = await route(new Request("https://example.com/api/_/health", { method: "HEAD" }), env)
    assert.equal(head.status, 200)
    assert.equal(await head.text(), "")
    assert.equal((await route(new Request("https://example.com/api/_/health", { method: "POST" }), env)).status, 405)
    const session = await worker.fetch(new Request("https://example.com/api/_/session"), env)
    assert.equal(session.status, 503)
    assert.equal(session.headers.get("referrer-policy"), "no-referrer")
    assert.equal(session.headers.get("x-robots-tag"), "noindex, nofollow")
    const index = await (await route(new Request("https://example.com/api"), env)).json()
    assert.equal(index.health, "/api/_/health")
})

test("reserved system IDs and retired URLs never enter the custom gateway", async () => {
    for (const path of ["/api/_/sample", "/api/_/server/agent", "/api/_/session"]) assert.equal(gateway_target(path), null)
    for (const path of ["/api/v1/health", "/api/v1/auth/session", "/api/server", "/api/_/missing"]) {
        const response = await route(new Request(`https://example.com${path}`), env, async () => { throw new Error("Unexpected proxy request") })
        assert.equal(response.status, 501, path)
    }
})
