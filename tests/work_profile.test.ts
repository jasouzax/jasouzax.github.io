import { test } from "node:test"
import assert from "node:assert/strict"
import { google_picture } from "../src/work_profile.ts"
test("Google profile images accept HTTPS Google image hosts and reject active or unrelated URLs", () => {
    assert.equal(google_picture("https://lh3.googleusercontent.com/a/photo=s96-c"), "https://lh3.googleusercontent.com/a/photo=s96-c")
    for (const value of [undefined, "javascript:alert(1)", "data:image/svg+xml,<svg/>", "http://lh3.googleusercontent.com/a", "https://lh3.googleusercontent.com.evil.test/a", "https://evil.test/photo", "https://user:password@lh3.googleusercontent.com/a", "https://lh3.googleusercontent.com:8443/a", "x".repeat(2049)]) assert.equal(google_picture(value), "")
})
