import { test } from "node:test"
import assert from "node:assert/strict"
import { Drive_Vault, type Key_Vault } from "../src/web/client/work_drive.ts"
import { encode_key, generate_owner_key, wrap_room_key } from "../src/work_crypto.ts"

test("Drive key creation recovers after a lost acknowledgement and never overwrites a different device's key", async () => {
    const original = globalThis.fetch
    const files = new Map<string, Key_Vault>()
    let reserved = "", ids = 0, accesses = 0, fail_ack = true
    const api = async (path: string, body?: any) => {
        if (path === "/api/v1/auth/drive") return { access_token: `synthetic-${++accesses}` }
        assert.equal(path, "/api/v1/work/key-file")
        if (body && !reserved) reserved = body.file_id
        assert.equal(JSON.stringify(body ?? {}).includes("private_jwk"), false)
        return { file_id: reserved || null }
    }
    let expired_once = true
    globalThis.fetch = async (input, init) => {
        const url = new URL(String(input))
        assert.equal(url.origin, "https://www.googleapis.com")
        assert.equal(init?.credentials, "omit")
        if (expired_once) { expired_once = false; return Response.json({}, { status: 401 }) }
        if (url.pathname.endsWith("/generateIds")) return Response.json({ ids: [`generated-file-id-${++ids}`] })
        if (url.pathname === "/drive/v3/files") return Response.json({ files: [] })
        if (url.pathname.startsWith("/drive/v3/files/")) {
            const value = files.get(url.pathname.split("/").pop()!)
            return value ? Response.json(value) : Response.json({}, { status: 404 })
        }
        assert.equal(url.pathname, "/upload/drive/v3/files")
        assert.equal(init?.method, "POST", "key files are immutable")
        const parts = String(init!.body).split("\r\n\r\n")
        const metadata = JSON.parse(parts[1].split("\r\n--")[0])
        assert.deepEqual(metadata.parents, ["appDataFolder"])
        if (files.has(metadata.id)) return Response.json({}, { status: 409 })
        files.set(metadata.id, JSON.parse(parts[2].split("\r\n--")[0]))
        if (fail_ack) { fail_ack = false; throw new TypeError("Lost upload acknowledgement") }
        return Response.json({ id: metadata.id })
    }
    try {
        const first = await Drive_Vault.open(api), second = await Drive_Vault.open(api)
        const pair = await generate_owner_key()
        const room = crypto.randomUUID(), raw = encode_key(crypto.getRandomValues(new Uint8Array(32)))
        const value: Key_Vault = { v: 2, client: { room, key: raw, key_id: "owner-key-id", owner_wrap: await wrap_room_key(raw, pair.public_jwk, room) } }
        await assert.rejects(first.create(value), /Lost upload/)
        assert.deepEqual(await first.create(value), value)
        assert.deepEqual(await second.create({ v: 2, owner: pair }), value, "another device must restore the winner instead of overwriting it")
        assert.equal(files.size, 1)
        assert.equal(accesses, 3, "expired Drive access is refreshed through the session")
    } finally { globalThis.fetch = original }
})
