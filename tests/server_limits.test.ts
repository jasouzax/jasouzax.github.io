import { test } from "node:test"
import assert from "node:assert/strict"
import { Rate_Limit } from "../cloud/hub/limits.ts"

test("one key is limited per window and gets a retry time", () => {
    const limit = new Rate_Limit({ per_key: 2, total: 100 })
    assert.deepEqual(limit.take("a", 1000), { ok: true })
    assert.deepEqual(limit.take("a", 2000), { ok: true })
    assert.deepEqual(limit.take("a", 3000), { ok: false, retry_after: 58 })
    assert.deepEqual(limit.take("b", 3000), { ok: true })
    assert.deepEqual(limit.take("a", 61_000), { ok: true })
})

test("the total budget protects the free tier from many different callers", () => {
    const limit = new Rate_Limit({ per_key: 5, total: 3 })
    for (const key of ["a", "b", "c"]) assert.equal(limit.take(key, 0).ok, true)
    assert.equal(limit.take("d", 10).ok, false)
    assert.equal(limit.take("d", 60_001).ok, true)
})

test("the key table cannot grow without bound, and expired keys make room", () => {
    const limit = new Rate_Limit({ per_key: 1, total: 1000, max_keys: 2 })
    assert.equal(limit.take("a", 0).ok, true)
    assert.equal(limit.take("b", 0).ok, true)
    assert.equal(limit.take("c", 1).ok, false)
    assert.equal(limit.take("c", 60_001).ok, true)
})
