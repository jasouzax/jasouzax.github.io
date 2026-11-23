/* Real SQLite and policy tests for versioned APIs; no external credentials or published services. */
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createHash } from "node:crypto"
import { Runtime_API } from "../../../server/api/runtime.ts"
import type { Api_Call, Api_Config } from "../../../shared/api/types.ts"
const call = (path = "/", extra: Partial<Api_Call> = {}): Api_Call => ({ method: "GET", path, query: {}, headers: {}, actor: { owner: false }, ip: "127.0.0.1", request_id: crypto.randomUUID(), ...extra })
function fixture(extra: Partial<Api_Config> = {}) {
    const directory = mkdtempSync(join(tmpdir(), "jazu-api-unit-")), api = new Runtime_API({ id: "sample", version: 1, access: "public", ...extra }, directory)
    return { api, directory, close() { api.store.close(); rmSync(directory, { recursive: true, force: true }) } }
}
test("routes prefer static, then parameters, then a final wildcard and decode once", async () => {
    const f = fixture()
    try {
        f.api.get("/*rest", ctx => ctx.params).get("/:name", ctx => ctx.params).get("/fixed", () => "static")
        const request = call("/fixed"), result = await f.api.dispatch(request)
        assert.deepEqual(result.body, { data: "static", meta: { request_id: request.request_id } })
        assert.deepEqual({ ...((await f.api.dispatch(call("/hello%20world"))).body as any).data }, { name: "hello world" })
        assert.deepEqual({ ...((await f.api.dispatch(call("/a/b/c"))).body as any).data }, { rest: "a/b/c" })
        assert.equal(((await f.api.dispatch(call("/%252e%252e"))).body as any).data.name, "%2e%2e")
        assert.equal((await f.api.dispatch(call("/%2e%2e"))).status, 400)
        assert.equal((await f.api.dispatch(call("/%2F"))).status, 400)
        assert.equal((await f.api.dispatch(call("/fixed", { method: "HEAD" }))).status, 200)
        assert.throws(() => f.api.get("/invalid/*rest/tail", () => null))
        assert.throws(() => f.api.get("/:duplicate", () => null))
    } finally { f.close() }
})
test("tokens, scopes, revocation and owner bypass are enforced in the server runtime", async () => {
    const hash = createHash("sha256").update("service-secret").digest("hex"), f = fixture({ access: "token", tokens: [{ hash, scopes: ["read"] }], rate: { requests: 2, seconds: 60 } })
    try {
        f.api.get("/", { scopes: ["read"] }, ctx => ({ actor: ctx.actor.owner, authorization: ctx.headers.authorization ?? null }))
        assert.equal((await f.api.dispatch(call())).status, 404)
        const headers = { authorization: "Bearer service-secret" }
        assert.equal((await f.api.dispatch(call("/", { headers }))).status, 200)
        assert.equal((await f.api.dispatch(call("/", { headers }))).status, 200)
        assert.equal((await f.api.dispatch(call("/", { headers }))).status, 429)
        assert.equal((await f.api.dispatch(call("/", { actor: { owner: true } }))).status, 200)
        f.api.config.tokens = []
        assert.equal((await f.api.dispatch(call("/", { headers }))).status, 404)
        assert.equal(JSON.stringify(f.api.manifest()).includes(hash), false)
        f.api.config.tokens = [{ hash, scopes: [] }]
        assert.equal((await f.api.dispatch(call("/", { headers }))).status, 403)
        f.api.config.access = "owner"
        assert.equal((await f.api.dispatch(call("/", { headers }))).status, 404)
    } finally { f.close() }
})
test("schemas, QUERY, HEAD, timeouts, response policy and store rollback work", async () => {
    const f = fixture({ response: "strict", timeout_ms: 30, deprecated: "2027-01-01" })
    try {
        f.api.post("/number", { body: { type: "number" }, response: { type: "number" } }, ctx => ctx.body)
        f.api.query("/search", ctx => ctx.query)
        f.api.get("/invalid", { response: { type: "number" } }, () => "not a number")
        f.api.get("/wait", () => new Promise(() => {}))
        assert.equal((await f.api.dispatch(call("/number", { method: "POST", body: "bad" }))).status, 400)
        const good = await f.api.dispatch(call("/number", { method: "POST", body: 5 }))
        assert.equal(good.status, 200); assert.equal(good.headers.deprecation, `@${Date.parse("2027-01-01") / 1000}`)
        assert.equal((await f.api.dispatch(call("/search", { method: "QUERY", query: { q: "hello" } }))).status, 200)
        assert.equal((await f.api.dispatch(call("/invalid"))).status, 502)
        assert.equal((await f.api.dispatch(call("/wait"))).status, 504)
        f.api.store.set("value", { count: 1 })
        assert.throws(() => f.api.store.transaction(() => { f.api.store.set("value", { count: 2 }); throw new Error("rollback") }))
        assert.deepEqual(f.api.store.get("value"), { count: 1 })
    } finally { f.close() }
})
