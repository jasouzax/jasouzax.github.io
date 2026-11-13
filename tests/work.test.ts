/* Work encryption and authorization contracts using the real SQL against SQLite. */
import { test } from "node:test"
import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"
import { readFileSync } from "node:fs"
import { work_route, type Work_Env, type Work_Statement } from "../src/node/work.ts"
import { encrypt_message, decrypt_message, encode_key } from "../src/work_crypto.ts"
import { route } from "../src/node/worker.ts"

const owner = "owner_" + "a".repeat(48)
const origin = "https://example.com"
const base = "/api/v1/work/rooms"
const key = () => encode_key(crypto.getRandomValues(new Uint8Array(32)))

function fixture() {
    const db = new DatabaseSync(":memory:")
    db.exec(readFileSync("migrations/0002_work_chat.sql", "utf8"))
    const env: Work_Env = { WORK_OWNER_TOKEN: owner, DB: { prepare(sql) {
        let values: any[] = []
        const statement: Work_Statement = {
            bind(...args) { values = args; return statement },
            async first<T>() { return db.prepare(sql).get(...values) as T ?? null },
            async all<T>() { return { results: db.prepare(sql).all(...values) as T[] } },
            async run() { return db.prepare(sql).run(...values) },
        }
        return statement
    } } }
    const request = (path: string, token = owner, body?: unknown, headers?: Record<string, string>) => new Request(origin + path, { method: body === undefined ? "GET" : "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-jazu-work": "1", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
    const api = (path: string, token = owner, body?: unknown, headers?: Record<string, string>) => work_route(request(path, token, body, headers), env)
    const room = async (email: string) => {
        const result = await api(base, owner, { email })
        assert.equal(result.status, 201)
        return await result.json() as { room: { id: string, email: string }, token: string }
    }
    return { db, env, api, request, room }
}

test("Work AES-GCM roundtrip, random IV and authentication of room/id/author", async () => {
    const shared = key()
    const context = { room: crypto.randomUUID(), id: crypto.randomUUID(), author: "client" as const }
    const plain = "Hello 世界 👋\n<script>alert('xss')</script>"
    const envelope = await encrypt_message(shared, plain, context)
    assert.equal(await decrypt_message(shared, envelope, context), plain)
    assert.notEqual((await encrypt_message(shared, plain, context)).iv, envelope.iv)
    for (const changed of [{ ...context, room: crypto.randomUUID() }, { ...context, id: crypto.randomUUID() }, { ...context, author: "owner" as const }]) await assert.rejects(decrypt_message(shared, envelope, changed))
    await assert.rejects(decrypt_message(key(), envelope, context))
    const altered = { ...envelope, ciphertext: (envelope.ciphertext[0] === "A" ? "B" : "A") + envelope.ciphertext.slice(1) }
    await assert.rejects(decrypt_message(shared, altered, context))
    await assert.rejects(encrypt_message(shared, " ", context))
    await assert.rejects(encrypt_message(shared, "あ".repeat(2700), context))
})

test("Work rooms isolate clients, bind authors, persist only ciphertext and deduplicate retries", async () => {
    const f = fixture()
    try {
        const a = await f.room("first@example.com")
        const b = await f.room("second@example.com")
        assert.equal((await f.api(base, a.token)).status, 403)
        assert.equal((await f.api(`${base}/${b.room.id}`, a.token)).status, 404)
        assert.equal((await f.api(`${base}/${a.room.id}`, "z".repeat(40))).status, 404)
        const context = { room: a.room.id, id: crypto.randomUUID(), author: "client" as const }
        const shared = key()
        const body = { id: context.id, envelope: await encrypt_message(shared, "private message", context) }
        const endpoint = `${base}/${a.room.id}/messages`
        assert.equal((await f.api(endpoint, a.token, body)).status, 201)
        assert.equal((await f.api(endpoint, a.token, body)).status, 200)
        assert.equal((await f.api(endpoint, owner, body)).status, 409)
        assert.equal((await f.api(endpoint, a.token, { ...body, author: "owner" })).status, 400)
        assert.equal((await f.api(endpoint, a.token, { id: crypto.randomUUID(), body: "plaintext" })).status, 400)
        const data = await (await f.api(endpoint, owner)).json() as any
        assert.equal(data.messages.length, 1)
        assert.equal(await decrypt_message(shared, data.messages[0].envelope, context), "private message")
        assert.equal((f.db.prepare("SELECT envelope FROM work_messages").get() as any).envelope.includes("private message"), false)
        assert.notEqual((f.db.prepare("SELECT token_hash FROM work_rooms WHERE id = ?").get(a.room.id) as any).token_hash, a.token)
        const after = await (await f.api(`${endpoint}?after=${data.messages[0].seq}`, a.token)).json() as any
        assert.deepEqual(after.messages, [])
        assert.equal((await f.api(`${endpoint}?after=-1`, a.token)).status, 400)
        assert.equal((await f.api(endpoint, b.token)).status, 404)
        assert.equal((await f.api(`${base}/${a.room.id}/revoke`, a.token, {})).status, 403)
        assert.equal((await f.api(`${base}/${a.room.id}/revoke`, owner, {})).status, 200)
        assert.equal((await f.api(endpoint, a.token)).status, 404)
        assert.equal((await f.api(endpoint, owner, body)).status, 403)
    } finally { f.db.close() }
})

test("Work rejects cross-origin/unauthenticated/oversize requests and limits bursts", async () => {
    const f = fixture()
    try {
        assert.equal((await f.api(base, "")).status, 401)
        assert.equal((await f.api(base, owner, { email: "a@example.com" }, { origin: "https://evil.com" })).status, 403)
        assert.equal((await f.api(base, owner, {}, { "x-jazu-work": "" })).status, 403)
        assert.equal((await f.api(base, owner, { email: "bad" })).status, 400)
        const a = await f.room("client@example.com")
        const provision = { email: "retry@example.com", id: crypto.randomUUID(), token: "b".repeat(43) }
        assert.equal((await f.api(base, owner, provision)).status, 201)
        assert.equal((await f.api(base, owner, provision)).status, 200)
        assert.equal((await f.api(base, owner, { ...provision, token: "c".repeat(43) })).status, 409)
        assert.equal((await f.api(base, owner, { email: "CLIENT@example.com" })).status, 409)
        const context = { room: a.room.id, id: crypto.randomUUID(), author: "client" as const }
        const envelope = await encrypt_message(key(), "hello", context)
        const endpoint = `${base}/${a.room.id}/messages`
        const results = await Promise.all(Array.from({ length: 31 }, () => f.api(endpoint, a.token, { id: crypto.randomUUID(), envelope })))
        assert.equal(results.filter(result => result.status === 201).length, 30)
        assert.equal(results.filter(result => result.status === 429).length, 1)
        assert.equal((await f.api(endpoint, a.token, { id: crypto.randomUUID(), envelope: { v: 1, iv: envelope.iv, ciphertext: "a".repeat(13000) } })).status, 400)
        const routed = await route(f.request(base), { ...f.env, DOMAIN: "example.com", PAGES_ORIGIN: "https://example.pages.dev" })
        assert.equal(routed.status, 200)
        assert.equal(routed.headers.get("cache-control"), "no-store")
        assert.equal((await work_route(f.request(base), {})).status, 503)
    } finally { f.db.close() }
})
