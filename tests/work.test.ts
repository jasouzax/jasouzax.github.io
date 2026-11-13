/* Real SQLite and Web Crypto: automatic guests, account claims and ciphertext isolation. */
import { test } from "node:test"
import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"
import { readFileSync } from "node:fs"
import { work_route, type Work_Env, type Work_Statement } from "../src/node/work.ts"
import { auth_hash } from "../src/node/auth.ts"
import { encrypt_message, decrypt_message, encode_key, generate_owner_key, wrap_room_key, unwrap_room_key } from "../src/work_crypto.ts"
const origin = "https://example.com", base = "/api/v1/work/rooms"
const random = () => encode_key(crypto.getRandomValues(new Uint8Array(32)))
type Identity = { cookie: string, csrf: string }
async function fixture() {
    const db = new DatabaseSync(":memory:")
    for (const file of ["0002_work_chat.sql", "0003_google_auth.sql", "0004_guest_messaging.sql"]) db.exec(readFileSync(`migrations/${file}`, "utf8"))
    const env: Work_Env = { GOOGLE_CLIENT_ID: "test.apps.googleusercontent.com", DB: { prepare(sql) {
        let values: any[] = []
        const statement: Work_Statement = { bind(...args) { values = args; return statement }, async first<T>() { return db.prepare(sql).get(...values) as T ?? null }, async all<T>() { return { results: db.prepare(sql).all(...values) as T[] } }, async run() { return db.prepare(sql).run(...values) } }
        return statement
    } } }
    const api = (path: string, who?: Identity, body?: unknown, headers?: Record<string, string>) => work_route(new Request(origin + path, { method: body === undefined ? "GET" : "POST", headers: { origin, cookie: who?.cookie ?? "", "content-type": "application/json", "x-jazu-work": "1", "x-jazu-csrf": who?.csrf ?? "", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), env)
    const client = async (email: string, subject = email): Promise<Identity> => {
        const token = random()
        db.prepare("INSERT OR IGNORE INTO auth_users VALUES (?, ?, 'Test', ?)").run(subject, email, Date.now())
        db.prepare("INSERT INTO auth_sessions VALUES (?, ?, ?, ?)").run(await auth_hash(token), subject, Date.now(), Date.now())
        return { cookie: `__Host-jazu_session=${token}`, csrf: await auth_hash(`csrf\n${token}`) }
    }
    const owner = await client("jason@jasouza.com", "owner")
    db.prepare("INSERT INTO auth_owner VALUES (1, 'owner')").run()
    const pair = await generate_owner_key()
    const published = await api("/api/v1/work/owner-key", owner, { public_jwk: pair.public_jwk })
    assert.equal(published.status, 200)
    const { key_id } = await published.json() as any
    const guest = async (): Promise<Identity> => {
        const response = await api("/api/v1/work/session", undefined, {})
        assert.equal(response.status, 200)
        return { cookie: response.headers.get("set-cookie")!.split(";")[0], csrf: (await response.json() as any).csrf }
    }
    const room = async (who: Identity) => {
        const id = crypto.randomUUID(), key = random()
        const body = { id, key_id, owner_wrap: await wrap_room_key(key, pair.public_jwk, id) }
        const response = await api(base, who, body)
        assert.equal(response.status, 201)
        return { id, key, body }
    }
    return { db, env, api, client, owner, pair, key_id, guest, room }
}

test("shared keys roundtrip and owner wrapping authenticates both room and private key", async () => {
    const pair = await generate_owner_key(), key = random(), room = crypto.randomUUID()
    const wrapped = await wrap_room_key(key, pair.public_jwk, room)
    assert.equal(await unwrap_room_key(wrapped, pair.private_jwk, room), key)
    await assert.rejects(unwrap_room_key(wrapped, pair.private_jwk, crypto.randomUUID()))
    await assert.rejects(unwrap_room_key(wrapped, (await generate_owner_key()).private_jwk, room))
    const context = { room, id: crypto.randomUUID(), author: "client" as const }
    const plain = "Hello 世界 👋 <script>unsafe()</script>"
    const envelope = await encrypt_message(key, plain, context)
    assert.equal(await decrypt_message(key, envelope, context), plain)
    assert.notEqual((await encrypt_message(key, plain, context)).iv, envelope.iv)
    for (const changed of [{ ...context, room: crypto.randomUUID() }, { ...context, author: "owner" as const }, { ...context, id: crypto.randomUUID() }]) await assert.rejects(decrypt_message(key, envelope, changed))
    await assert.rejects(encrypt_message(key, " ", context))
    await assert.rejects(encrypt_message(key, "あ".repeat(2700), context))
})

test("automatic guests send ciphertext without invitations; cookies isolate rooms and retries deduplicate", async () => {
    const f = await fixture()
    try {
        const first = await f.guest(), second = await f.guest()
        const room = await f.room(first), other = await f.room(second)
        assert.equal((await f.api(base, first)).status, 403)
        assert.equal((await f.api(`${base}/${other.id}`, first)).status, 404)
        assert.equal((await f.api(`${base}/${room.id}`)).status, 401)
        assert.equal((await f.api(base, undefined, undefined, { authorization: `Bearer ${"old-secret-".repeat(5)}` })).status, 403)
        const id = crypto.randomUUID()
        const message = { id, envelope: await encrypt_message(room.key, "secret guest message", { room: room.id, id, author: "client" }) }
        const path = `${base}/${room.id}/messages`
        assert.equal((await f.api(path, first, message)).status, 201)
        assert.equal((await f.api(path, first, message)).status, 200)
        assert.equal((await f.api(path, f.owner, message)).status, 409)
        assert.equal((await f.api(path, second, message)).status, 404)
        assert.equal((await f.api(path, first, { ...message, author: "owner" })).status, 400)
        const listed = await (await f.api(base, f.owner)).json() as any
        assert.equal(listed.rooms.length, 1, "empty visits are not listed")
        assert.match(listed.rooms[0].email, /^guest\/\d+$/)
        const unwrapped = await unwrap_room_key(listed.rooms[0].owner_wrap, f.pair.private_jwk, room.id)
        const messages = await (await f.api(path, f.owner)).json() as any
        assert.equal(await decrypt_message(unwrapped, messages.messages[0].envelope, { room: room.id, id, author: "client" }), "secret guest message")
        const stored = JSON.stringify(f.db.prepare("SELECT * FROM work_rooms").all()) + JSON.stringify(f.db.prepare("SELECT * FROM work_messages").all())
        assert.equal(stored.includes(room.key), false)
        assert.equal(stored.includes("secret guest message"), false)
        assert.equal(stored.includes('"d":'), false)
        assert.equal((await (await f.api(`${path}?after=${messages.messages[0].seq}`, first)).json() as any).messages.length, 0)
        assert.equal((await (await f.api("/api/v1/work/session", first, {})).json() as any).guest_room.id, room.id)
    } finally { f.db.close() }
})

test("guest claims require the original browser; existing account conversations cannot be merged or overwritten", async () => {
    const f = await fixture()
    try {
        const guest = await f.guest(), stranger = await f.guest(), client = await f.client("client@example.com")
        const room = await f.room(guest), path = `${base}/${room.id}`
        assert.equal((await f.api(path + "/bind", client, {})).status, 404)
        const claimed = { cookie: `${client.cookie}; ${guest.cookie}`, csrf: client.csrf }
        assert.equal((await f.api(path + "/bind", claimed, {})).status, 200)
        assert.equal((await f.api(path, guest)).status, 404)
        assert.equal((await f.api(path, client)).status, 200)
        assert.equal((await f.api(path, stranger)).status, 404)
        const later_guest = await f.guest(), later_room = await f.room(later_guest)
        const conflicted = { cookie: `${client.cookie}; ${later_guest.cookie}`, csrf: client.csrf }
        assert.equal((await f.api(`${base}/${later_room.id}/bind`, conflicted, {})).status, 409)
        assert.equal((f.db.prepare("SELECT google_subject FROM work_rooms WHERE id = ?").get(later_room.id) as any).google_subject, null)
        assert.equal((await f.api(`${base}/${later_room.id}`, later_guest)).status, 200)
        assert.equal((await (await f.api("/api/v1/work/session", conflicted, {})).json() as any).room.id, room.id)
        assert.equal((await f.api("/api/v1/work/key-file", client, { file_id: "immutable-key-file-0001" })).status, 200)
        assert.equal((await (await f.api("/api/v1/work/key-file", client, { file_id: "another-key-file-0002" })).json() as any).file_id, "immutable-key-file-0001")
        assert.equal((await (await f.api("/api/v1/work/key-file", await f.client("other@example.com"))).json() as any).file_id, null)
    } finally { f.db.close() }
})

test("messaging rejects CSRF, invalid envelopes and owner key replacement, with durable burst limits", async () => {
    const f = await fixture()
    try {
        assert.equal((await f.api("/api/v1/work/session", undefined, {}, { origin: "https://evil.example" })).status, 403)
        assert.equal((await f.api("/api/v1/work/session", undefined, {}, { "x-jazu-work": "" })).status, 403)
        const guest = await f.guest(), room = await f.room(guest)
        assert.equal((await f.api(base, guest, room.body, { "x-jazu-csrf": "" })).status, 403)
        assert.equal((await f.api("/api/v1/work/owner-key", guest, { public_jwk: f.pair.public_jwk })).status, 403)
        assert.equal((await f.api("/api/v1/work/owner-key", f.owner, { public_jwk: (await generate_owner_key()).public_jwk })).status, 409)
        const path = `${base}/${room.id}/messages`
        assert.equal((await f.api(path, guest, { id: crypto.randomUUID(), body: "plaintext" })).status, 400)
        assert.equal((await f.api(path + "?after=-1", guest)).status, 400)
        for (let index = 0; index < 31; index++) {
            const id = crypto.randomUUID()
            const message = { id, envelope: await encrypt_message(room.key, "bounded", { room: room.id, id, author: "client" }) }
            assert.equal((await f.api(path, guest, message)).status, index < 30 ? 201 : 429)
        }
        for (let index = 1; index < 20; index++) await f.guest()
        assert.equal((await f.api("/api/v1/work/session", undefined, {})).status, 429)
    } finally { f.db.close() }
})

test("owner pagination includes every client when creation timestamps tie", async () => {
    const f = await fixture()
    try {
        for (let index = 0; index < 101; index++) {
            const id = crypto.randomUUID()
            f.db.prepare("INSERT INTO work_rooms (id,email,token_hash,created_at,owner_wrap) VALUES (?, ?, ?, 100, '{}')").run(id, `guest/${index}`, id)
            f.db.prepare("INSERT INTO work_messages (room_id,id,author,envelope,created_at) VALUES (?,?,'client','{}',100)").run(id, crypto.randomUUID())
        }
        const first = await (await f.api(base, f.owner)).json() as any
        const second = await (await f.api(`${base}?before=${first.next}`, f.owner)).json() as any
        assert.equal(new Set([...first.rooms, ...second.rooms].map(room => room.id)).size, 101)
        assert.equal(second.next, null)
    } finally { f.db.close() }
})
