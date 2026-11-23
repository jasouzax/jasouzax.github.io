/* Durable job/request semantics use real SQLite, including failed transactions and restart interruption. */
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { setTimeout } from "node:timers/promises"
import { Runtime_API } from "../../../server/api/runtime.ts"
import type { Api_Call } from "../../../shared/api/types.ts"
const call = (body: unknown, extra: Partial<Api_Call> = {}): Api_Call => ({ method: "POST", path: "/", body, headers: { "idempotency-key": "request-1" }, query: {}, actor: { owner: false }, ip: "client", request_id: crypto.randomUUID(), ...extra })
async function until(check: () => boolean): Promise<void> { for (let count = 0; count < 100 && !check(); count++) await setTimeout(10); assert(check()) }
test("idempotent routes replay results, reject changed payloads and isolate keys by principal", async () => {
    const root = mkdtempSync(join(tmpdir(), "api-requests-")), api = new Runtime_API({ id: "requests", version: 1, access: "public" }, root)
    let calls = 0, release: (() => void) | undefined
    api.post("/", { idempotent: true }, async ctx => { calls++; if ((ctx.body as any)?.wait) await new Promise<void>(done => { release = done }); return { calls } })
    try {
        const first = await api.dispatch(call({ b: 2, a: 1 }))
        assert.deepEqual((await api.dispatch(call({ a: 1, b: 2 }))).body, first.body)
        assert.equal(calls, 1)
        assert.equal((await api.dispatch(call({ a: 2 }))).status, 409)
        assert.equal((await api.dispatch(call({ b: 2, a: 1 }, { actor: { owner: true, subject: "owner" } }))).status, 200)
        assert.equal(calls, 2)
        const pending = api.dispatch(call({ wait: true }, { headers: { "idempotency-key": "pending" } }))
        await until(() => !!release)
        assert.equal((await api.dispatch(call({ wait: true }, { headers: { "idempotency-key": "pending" } }))).status, 409)
        release!(); await pending
    } finally { api.close(); rmSync(root, { recursive: true, force: true }) }
})
test("jobs wait for activation, deduplicate durably and remain interrupted after restart", async () => {
    const root = mkdtempSync(join(tmpdir(), "api-jobs-"))
    let api = new Runtime_API({ id: "jobs", version: 1 }, root), calls = 0
    try {
        const job = api.job("double", (input: { value: number }) => { calls++; return input.value * 2 })
        const queued = job.run({ value: 3 }, { key: "job-1" })
        await setTimeout(10); assert.equal(calls, 0); assert.equal(api.jobs.get(queued.id)!.state, "queued")
        api.activate(); await until(() => api.jobs.get(queued.id)?.state === "succeeded")
        assert.equal(api.jobs.get(queued.id)!.result, 6)
        assert.equal(job.run({ value: 3 }, { key: "job-1" }).id, queued.id); assert.equal(calls, 1)
        assert.throws(() => job.run({ value: 4 }, { key: "job-1" }), /different payload/)
        assert.throws(() => api.store.transaction(() => { job.run({ value: 5 }, { key: "rollback" }); throw new Error("rollback") }))
        await setTimeout(10); assert.equal(calls, 1)
        const slow_job = api.job("slow", () => new Promise(() => {})), cancelled = slow_job.run()
        await until(() => api.jobs.get(cancelled.id)?.state === "running")
        assert(api.jobs.cancel(cancelled.id)); assert.equal(api.jobs.get(cancelled.id)!.state, "cancelled")
        const following = job.run({ value: 8 })
        await until(() => api.jobs.get(following.id)?.state === "succeeded")
        assert.equal(calls, 2)
        const slow = slow_job.run()
        await until(() => api.jobs.get(slow.id)?.state === "running")
        const other = new Runtime_API({ id: "jobs", version: 2 }, root)
        other.activate(); assert.equal(api.jobs.get(slow.id)!.state, "running"); other.close()
        api.close(); api = new Runtime_API({ id: "jobs", version: 1 }, root); api.activate()
        assert.equal(api.jobs.get(slow.id)!.state, "interrupted")
        assert.equal(api.jobs.get(queued.id)!.result, 6)
    } finally { api.close(); rmSync(root, { recursive: true, force: true }) }
})
test("an invented bearer cannot evade an anonymous IP rate limit", async () => {
    const root = mkdtempSync(join(tmpdir(), "api-rate-")), api = new Runtime_API({ id: "rate", version: 1, access: "public", rate: { requests: 1, seconds: 60 } }, root)
    api.get("/", () => "ok")
    try {
        assert.equal((await api.dispatch(call(null, { method: "GET", headers: {} }))).status, 200)
        assert.equal((await api.dispatch(call(null, { method: "GET", headers: { authorization: "Bearer invented" } }))).status, 429)
    } finally { api.close(); rmSync(root, { recursive: true, force: true }) }
})
