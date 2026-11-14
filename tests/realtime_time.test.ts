import { test } from "node:test"
import assert from "node:assert/strict"
import { relative_presence } from "../src/web/client/realtime_time.ts"
test("last-online text advances locally and handles recent, future and long-absent timestamps", () => {
    const last = 1000000
    assert.equal(relative_presence(last, "en", last + 180000), "3 minutes ago")
    assert.equal(relative_presence(last, "en", last + 240000), "4 minutes ago")
    assert.equal(relative_presence(last, "en", last + 300000), "5 minutes ago")
    assert.equal(relative_presence(last, "en", last + 3600000), "1 hour ago")
    assert.equal(relative_presence(last, "en", last + 86400000), "1 day ago")
    assert.equal(relative_presence(last, "en", last + 30000), null)
    assert.equal(relative_presence(last, "en", last - 30000), null)
    assert.equal(relative_presence(last, "ja", last + 180000), "3 分前")
})
