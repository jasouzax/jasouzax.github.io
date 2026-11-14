import { test } from "node:test"
import assert from "node:assert/strict"
import { get_auth } from "../src/web/client/sign.ts"
test("an older session request cannot restore an identity after a newer sign-out/refresh result", async () => {
    const original = globalThis.fetch
    let release!: (response: Response) => void, calls = 0
    globalThis.fetch = async () => ++calls === 1 ? new Promise<Response>(resolve => { release = resolve }) : Response.json({ user: null, csrf: "", google_enabled: true })
    try {
        const old = get_auth(true)
        assert.equal((await get_auth(true)).user, null)
        release(Response.json({ user: { email: "old@example.com", role: "client", name: "Old" }, csrf: "old", google_enabled: true }))
        assert.equal((await old).user, null)
        assert.equal((await get_auth()).user, null)
    } finally { globalThis.fetch = original }
})
