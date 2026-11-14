/* Real SQLite and Web Crypto: automatic guests, account claims and ciphertext isolation. */
import { test } from "node:test"
import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"
import { readFileSync } from "node:fs"
import { work_route, type Work_Env, type Work_Statement } from "../src/node/work.ts"
import { Realtime_Hub } from "../src/node/realtime.ts"
import { auth_hash, auth_route } from "../src/node/auth.ts"
import { save_google_grant } from "../src/node/google_grant.ts"
import { encrypt_message, decrypt_message, encode_key, generate_owner_key, wrap_room_key, unwrap_room_key } from "../src/work_crypto.ts"
const origin = "https://example.com", base = "/api/v1/work/rooms"
const random = () => encode_key(crypto.getRandomValues(new Uint8Array(32)))
type Identity = { cookie: string, csrf: string }
async function fixture() {
    const db = new DatabaseSync(":memory:")
    for (const file of ["0002_work_chat.sql", "0003_google_auth.sql", "0004_guest_messaging.sql", "0005_profile_images.sql", "0006_unstored_keys.sql", "0007_realtime.sql"]) db.exec(readFileSync(`migrations/${file}`, "utf8"))
    const env: Work_Env = { WORK_FALLBACK_KEY: random(), GOOGLE_CLIENT_ID: "test.apps.googleusercontent.com", DB: { prepare(sql) {
        let values: any[] = []
        const statement: Work_Statement = { bind(...args) { values = args; return statement }, async first<T>() { return db.prepare(sql).get(...values) as T ?? null }, async all<T>() { return { results: db.prepare(sql).all(...values) as T[] } }, async run() { return db.prepare(sql).run(...values) } }
        return statement
    }, async batch(statements) { db.exec("BEGIN"); try { for (const statement of statements) await statement.run(); db.exec("COMMIT") } catch (error) { db.exec("ROLLBACK"); throw error } } } }
    const api = (path: string, who?: Identity, body?: unknown, headers?: Record<string, string>, upstream?: typeof fetch) => work_route(new Request(origin + path, { method: body === undefined ? "GET" : "POST", headers: { origin, cookie: who?.cookie ?? "", "content-type": "application/json", "x-jazu-work": "1", "x-jazu-csrf": who?.csrf ?? "", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), env, { fetch: upstream })
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

test("client fallback keys are immutable, sealed outside D1 and isolated from guests, owners and other accounts", async () => {
    const f = await fixture(), path = "/api/v1/work/unstored-key"
    try {
        const client = await f.client("recovery@example.com"), stranger = await f.client("stranger@example.com"), guest = await f.guest()
        const make = async () => { const room = crypto.randomUUID(), key = random(); return { room, key, key_id: f.key_id, owner_wrap: await wrap_room_key(key, f.pair.public_jwk, room) } }
        const first = await make(), other = await make()
        for (const who of [guest, f.owner]) assert.equal((await f.api(path, who, { action: "save", client: first })).status, 403)
        assert.equal((await f.api(path, client, { action: "save", client: first }, { "x-jazu-csrf": "wrong" })).status, 403)
        const results = await Promise.all([first, other].map(client_key => f.api(path, client, { action: "save", client: client_key })))
        const stored = (await results[0].json() as any).client
        assert.deepEqual((await results[1].json() as any).client, stored, "concurrent devices restore the first immutable backup")
        const competitor = stored.room === first.room ? other : first
        assert.equal((await f.api(base, client, { id: competitor.room, owner_wrap: competitor.owner_wrap, key_id: competitor.key_id })).status, 409, "a competing Drive key cannot claim a different room after fallback reservation")
        assert.equal((await f.api(base, client, { id: stored.room, owner_wrap: stored.owner_wrap, key_id: stored.key_id })).status, 201)
        const row = f.db.prepare("SELECT * FROM unstored_keys").get() as any
        assert.equal(row.email, "recovery@example.com"); assert.equal(row.room_id, stored.room)
        assert.equal(row.sealed.includes(stored.key), false)
        assert.deepEqual((await (await f.api(path, client, { action: "load" })).json() as any).client, stored)
        assert.equal((await (await f.api(path, stranger, { action: "load" })).json() as any).client, null)
        const secret = f.env.WORK_FALLBACK_KEY; f.env.WORK_FALLBACK_KEY = random()
        assert.equal((await f.api(path, client, { action: "load" })).status, 503)
        assert.equal((await f.api(path, client, { action: "save", client: other })).status, 503)
        f.env.WORK_FALLBACK_KEY = secret
        f.db.prepare("INSERT INTO unstored_keys VALUES (?, ?, ?, ?, ?)").run("stranger@example.com", "stranger@example.com", crypto.randomUUID(), row.sealed, Date.now())
        assert.equal((await f.api(path, stranger, { action: "load" })).status, 503, "AAD prevents copying a backup to another identity or room")
        const deletion = await auth_route(new Request(origin + "/api/v1/auth/account/delete", { method: "POST", headers: { origin, cookie: client.cookie, "x-jazu-work": "1", "x-jazu-csrf": client.csrf, "x-jazu-confirm-delete": "account" } }), f.env)
        assert.equal(deletion.status, 200)
        assert.equal(f.db.prepare("SELECT count(*) AS n FROM unstored_keys WHERE subject = 'recovery@example.com'").get()!.n, 0)
    } finally { f.db.close() }
})

test("Drive handoff independently verifies the uploaded key, retains failures and deletes the backup without allowing resurrection", async () => {
    const f = await fixture(), path = "/api/v1/work/unstored-key"
    try {
        const client = await f.client("handoff@example.com"), room = await f.room(client)
        const value = { room: room.id, key: room.key, key_id: f.key_id, owner_wrap: room.body.owner_wrap }
        assert.equal((await f.api(path, client, { action: "save", client: value })).status, 200)
        await f.api("/api/v1/work/key-file", client, { file_id: "reserved-drive-file" })
        const action = { action: "drive" }
        assert.equal((await f.api(path, client, action)).status, 503, "no Drive credentials keeps the backup")
        await save_google_grant(f.env, client.cookie.split("=")[1], { access_token: "test-drive-access", expires_in: 3600, scope: "https://www.googleapis.com/auth/drive.appdata" })
        let mode = "different"
        const upstream: typeof fetch = async (url, init) => {
            assert.equal(String(url), "https://www.googleapis.com/drive/v3/files/reserved-drive-file?alt=media")
            assert.equal(init?.redirect, "manual"); assert.equal((init?.headers as any).authorization, "Bearer test-drive-access")
            if (mode === "redirect") return new Response(null, { status: 307, headers: { location: "https://untrusted.example/" } })
            return Response.json({ v: 2, client: mode === "different" ? { ...value, key: random() } : value })
        }
        assert.equal((await f.api(path, client, action, {}, upstream)).status, 409)
        mode = "redirect"; assert.equal((await f.api(path, client, action, {}, upstream)).status, 409)
        assert.equal(f.db.prepare("SELECT count(*) AS n FROM unstored_keys").get()!.n, 1)
        mode = "matching"
        f.db.exec("CREATE TRIGGER fail_backup_delete BEFORE DELETE ON unstored_keys BEGIN SELECT RAISE(ABORT, 'synthetic delete failure'); END;")
        assert.equal((await f.api(path, client, action, {}, upstream)).status, 503)
        assert.equal(f.db.prepare("SELECT count(*) AS n FROM work_key_promotions").get()!.n, 0, "failed deletion rolls back its completion marker")
        assert.equal(f.db.prepare("SELECT count(*) AS n FROM unstored_keys").get()!.n, 1)
        f.db.exec("DROP TRIGGER fail_backup_delete")
        assert.equal((await f.api(path, client, action, {}, upstream)).status, 200)
        assert.equal(f.db.prepare("SELECT count(*) AS n FROM unstored_keys").get()!.n, 0)
        assert.equal(f.db.prepare("SELECT count(*) AS n FROM work_key_promotions").get()!.n, 1)
        assert.equal((await f.api(path, client, { action: "save", client: value })).status, 409, "a stale tab cannot recreate the deleted backup")
        assert.equal((await f.api(path, client, action, {}, upstream)).status, 200, "lost deletion acknowledgements are safe to retry")
    } finally { f.db.close() }
})

test("a delivery outage retains the committed message and outbox; an alarm retries without duplicate messages", async () => {
    const f = await fixture(), original = (globalThis as any).WebSocketRequestResponsePair
    ;(globalThis as any).WebSocketRequestResponsePair = class {}
    try {
        const client = await f.client("delivery@example.com"), room = await f.room(client), source = "a:delivery@example.com", memory = new Map<string, any>()
        let available = false, alarm = 0
        const ctx: any = { getWebSockets: () => [], setWebSocketAutoResponse() {}, storage: { async get(key: string) { return memory.get(key) }, async put(key: string, value: unknown) { memory.set(key, value) }, async setAlarm(time: number) { alarm = time }, async deleteAlarm() { alarm = 0 } } }
        const hub = new Realtime_Hub(ctx, f.env)
        f.env.REALTIME = { idFromName: name => name, get: id => ({ async fetch(request) { if (id === source) return hub.fetch(request); if (!available) throw new Error("Synthetic recipient outage"); return Response.json({ ok: true }) } }) }
        const id = crypto.randomUUID(), envelope = await encrypt_message(room.key, "Committed despite delivery failure", { room: room.id, id, author: "client" })
        const path = `${base}/${room.id}/messages`
        assert.equal((await f.api(path, client, { id, envelope })).status, 201)
        assert.equal(f.db.prepare("SELECT count(*) AS n FROM work_messages").get()!.n, 1)
        assert.equal(f.db.prepare("SELECT count(*) AS n FROM realtime_outbox").get()!.n, 1)
        assert.ok(alarm > Date.now())
        assert.equal((await f.api(path, client, { id, envelope })).status, 200)
        assert.equal(f.db.prepare("SELECT count(*) AS n FROM work_messages").get()!.n, 1)
        available = true; await hub.alarm()
        assert.equal(f.db.prepare("SELECT count(*) AS n FROM realtime_outbox").get()!.n, 0)
        await hub.alarm(); assert.equal(alarm, 0)
    } finally { f.db.close(); (globalThis as any).WebSocketRequestResponsePair = original }
})

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
        const fresh_session = await f.api("/api/v1/work/session", guest, {})
        const fresh_guest = { cookie: fresh_session.headers.get("set-cookie")!.split(";")[0], csrf: (await fresh_session.json() as any).csrf }
        assert.notEqual(fresh_guest.cookie, guest.cookie, "sign-out after linking creates a new anonymous identity")
        const fresh_room = await f.room(fresh_guest)
        assert.notEqual(fresh_room.id, room.id)
        assert.equal((await f.api(path, fresh_guest)).status, 404)
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
