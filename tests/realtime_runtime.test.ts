/* Real workerd/D1/WebSocket coverage; no external accounts or network calls. */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { build } from "esbuild"
import { Miniflare, convertV4MiniflareOptions } from "miniflare"
import { auth_hash } from "../src/node/auth.ts"
import { encode_key, generate_owner_key, wrap_room_key, encrypt_message, decrypt_message } from "../src/work_crypto.ts"

const random = () => encode_key(crypto.getRandomValues(new Uint8Array(32)))
function stream(ws: any) {
    const queued: any[] = [], pending: { predicate: (value: any) => boolean, done: (value: any) => void }[] = []
    ws.addEventListener("message", (event: any) => {
        const value = event.data === "pong" ? "pong" : JSON.parse(event.data), index = pending.findIndex(item => item.predicate(value))
        if (index < 0) queued.push(value); else pending.splice(index, 1)[0].done(value)
    })
    const wait = (predicate: (value: any) => boolean): Promise<any> => {
        const index = queued.findIndex(predicate)
        if (index >= 0) return Promise.resolve(queued.splice(index, 1)[0])
        return new Promise((resolve, reject) => { const entry = { predicate, done: (value: any) => { clearTimeout(timer); resolve(value) } }; const timer = setTimeout(() => { pending.splice(pending.indexOf(entry), 1); reject(new Error("Expected live event was not received")) }, 15000); pending.push(entry) })
    }
    return { wait, async command(data: object) { const request_id = crypto.randomUUID(), response = wait(value => value.type === "ack" && value.request_id === request_id); ws.send(JSON.stringify({ ...data, request_id, channel: "work" })); return response } }
}
function message(ws: any): Promise<any> {
    return new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error("WebSocket response timed out")), 10000); ws.addEventListener("message", (event: any) => { clearTimeout(timer); resolve(event.data === "pong" ? "pong" : JSON.parse(event.data)) }, { once: true }) })
}
async function fixture() {
    const bundle = await build({ entryPoints: ["src/node/worker.ts"], bundle: true, write: false, format: "esm", platform: "browser", target: "es2022" })
    const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: "2026-11-04", bindings: { DOMAIN: "example.com", PAGES_ORIGIN: "https://pages.example.net", GOOGLE_CLIENT_ID: "synthetic" }, d1Databases: ["DB"], durableObjects: { REALTIME: { className: "Realtime_Hub", useSQLite: true } } }))
    const db = await runtime.getD1Database("DB")
    for (const name of readdirSync("migrations").filter(name => name.endsWith(".sql")).sort()) await db.exec(readFileSync(`migrations/${name}`, "utf8").replace(/--[^\n]*/g, "").split(";").map(sql => sql.trim().replace(/\s+/g, " ")).filter(Boolean).join(";\n"))
    const session = async (subject: string) => {
        const token = random(), now = Date.now()
        await db.prepare("INSERT OR IGNORE INTO auth_users VALUES (?, ?, 'Test', ?)").bind(subject, `${subject}@example.com`, now).run()
        await db.prepare("INSERT INTO auth_sessions VALUES (?, ?, ?, ?)").bind(await auth_hash(token), subject, now, now).run()
        return { cookie: `__Host-jazu_session=${token}`, token, csrf: await auth_hash(`csrf\n${token}`) }
    }
    const connect = async (cookie: string, origin = "https://example.com") => runtime.dispatchFetch("https://example.com/api/v1/realtime", { headers: { upgrade: "websocket", origin, cookie } })
    return { runtime, db, session, connect }
}
test("hibernating sockets authenticate, aggregate tabs, auto-pong, enforce guest caps and revoke sessions", async () => {
    const f = await fixture()
    try {
        const user = await f.session("client")
        assert.equal((await f.connect(user.cookie, "https://attacker.example")).status, 403)
        assert.equal((await f.connect("")).status, 401)
        const response = await f.connect(user.cookie); assert.equal(response.status, 101)
        const first = response.webSocket!; first.accept(); assert.equal((await message(first)).type, "ready")
        const second = (await f.connect(user.cookie)).webSocket!; second.accept(); await message(second)
        const pong = message(first); first.send("ping"); assert.equal(await pong, "pong")
        assert.equal((await f.db.prepare("SELECT last_online FROM last_signed_in WHERE principal = 'a:client'").first())!.last_online, null)
        first.close(1000, "Bye")
        await new Promise(resolve => setTimeout(resolve, 50))
        assert.equal((await f.db.prepare("SELECT last_online FROM last_signed_in WHERE principal = 'a:client'").first())!.last_online, null)
        await f.runtime.dispatchFetch("https://example.com/api/v1/auth/logout", { method: "POST", headers: { origin: "https://example.com", cookie: user.cookie, "x-jazu-work": "1", "x-jazu-csrf": user.csrf } })
        await new Promise(resolve => setTimeout(resolve, 50))
        assert.equal(typeof (await f.db.prepare("SELECT last_online FROM last_signed_in WHERE principal = 'a:client'").first())!.last_online, "number")
        const guest = random()
        await f.db.prepare("INSERT INTO work_guests (cookie_hash,ip_day,created_at) VALUES (?,'test',?)").bind(await auth_hash(guest), Date.now()).run()
        const old = (await f.connect(`__Host-jazu_guest=${guest}`)).webSocket!; old.accept(); await message(old)
        const closed = new Promise<number>(resolve => old.addEventListener("close", (event: any) => { old.close(); resolve(event.code) }, { once: true }))
        const replacement = (await f.connect(`__Host-jazu_guest=${guest}`)).webSocket!; replacement.accept(); await message(replacement)
        assert.equal(await closed, 4001)
        replacement.close(1000, "Bye")
    } finally { await f.runtime.dispose() }
})

test("WebSocket messages commit ciphertext before fanout, recover cursors, isolate users and push presence changes", async () => {
    const f = await fixture()
    try {
        const owner = await f.session("owner"), client = await f.session("client"), stranger = await f.session("stranger")
        await f.db.prepare("INSERT INTO auth_owner VALUES (1,'owner')").run()
        const api = (path: string, who: typeof owner, body: unknown) => f.runtime.dispatchFetch(`https://example.com${path}`, { method: "POST", headers: { origin: "https://example.com", cookie: who.cookie, "content-type": "application/json", "x-jazu-work": "1", "x-jazu-csrf": who.csrf }, body: JSON.stringify(body) })
        const pair = await generate_owner_key(), published = await (await api("/api/v1/work/owner-key", owner, { public_jwk: pair.public_jwk })).json() as any
        const conversation = crypto.randomUUID(), key = random()
        assert.equal((await api("/api/v1/work/rooms", client, { id: conversation, key_id: published.key_id, owner_wrap: await wrap_room_key(key, pair.public_jwk, conversation) })).status, 201)
        const connect = async (who: typeof owner) => { const ws = (await f.connect(who.cookie)).webSocket!; ws.accept(); const events = stream(ws); await events.wait(value => value.type === "ready"); return { ws, ...events } }
        const a = await connect(owner), b = await connect(client), c = await connect(stranger)
        assert.equal((await a.command({ type: "watch", conversation, after: 0 })).result.presence.online, true)
        assert.equal((await b.command({ type: "watch", conversation, after: 0 })).result.presence.online, true)
        assert.match((await c.command({ type: "watch", conversation, after: 0 })).error, /unavailable/i)
        const id = crypto.randomUUID(), envelope = await encrypt_message(key, "Durable socket message", { room: conversation, id, author: "client" })
        assert.ok((await c.command({ type: "send", conversation, id, envelope })).error)
        const sent = await b.command({ type: "send", conversation, id, envelope })
        assert.equal(sent.error, undefined)
        const saved = await f.db.prepare("SELECT seq, envelope FROM work_messages WHERE room_id = ? AND id = ?").bind(conversation, id).first<any>()
        assert.equal(saved.envelope.includes("Durable socket message"), false)
        const received = await a.wait(value => value.type === "messages" && value.messages.some((message: any) => message.id === id))
        assert.equal(received.messages[0].seq, saved.seq)
        assert.equal(await decrypt_message(key, received.messages[0].envelope, { room: conversation, id, author: "client" }), "Durable socket message")
        assert.equal((await a.wait(value => value.type === "notification" && value.id === id)).self, false)
        assert.equal((await b.command({ type: "send", conversation, id, envelope })).result.message.seq, saved.seq)
        assert.equal((await f.db.prepare("SELECT count(*) AS n FROM work_messages").first<any>()).n, 1)
        assert.equal((await f.db.prepare("SELECT count(*) AS n FROM realtime_outbox").first<any>()).n, 0)
        b.ws.close(1000, "Bye")
        const offline = await a.wait(value => value.type === "presence" && !value.online)
        assert.equal(typeof offline.last_online, "number")
        const resumed = await connect(client)
        await a.wait(value => value.type === "presence" && value.online)
        await resumed.command({ type: "watch", conversation, after: 0 })
        assert.equal((await resumed.wait(value => value.type === "messages")).messages[0].id, id)
        a.ws.close(); c.ws.close(); resumed.ws.close()
    } finally { await f.runtime.dispose() }
})

test("account deletion revokes every device and removes private presence/queued delivery state", async () => {
    const f = await fixture()
    try {
        const first = await f.session("deleted"), second = await f.session("deleted")
        const a = (await f.connect(first.cookie)).webSocket!; a.accept(); await message(a)
        const b = (await f.connect(second.cookie)).webSocket!; b.accept(); await message(b)
        const closed_a = new Promise<number>(resolve => a.addEventListener("close", (event: any) => { a.close(); resolve(event.code) }, { once: true }))
        const closed_b = new Promise<number>(resolve => b.addEventListener("close", (event: any) => { b.close(); resolve(event.code) }, { once: true }))
        const response = await f.runtime.dispatchFetch("https://example.com/api/v1/auth/account/delete", { method: "POST", headers: { origin: "https://example.com", cookie: first.cookie, "x-jazu-work": "1", "x-jazu-csrf": first.csrf, "x-jazu-confirm-delete": "account" } })
        assert.equal(response.status, 200)
        assert.deepEqual(await Promise.all([closed_a, closed_b]), [4003, 4003])
        assert.equal(await f.db.prepare("SELECT * FROM last_signed_in WHERE principal = 'a:deleted'").first(), null)
        assert.equal((await f.connect(second.cookie)).status, 401)
    } finally { await f.runtime.dispose() }
})

test("concurrent conversations on one socket retain every subscription", async () => {
    const f = await fixture()
    try {
        const owner = await f.session("owner"), first = await f.session("first"), second = await f.session("second")
        await f.db.prepare("INSERT INTO auth_owner VALUES (1,'owner')").run()
        const api = (path: string, who: typeof owner, body: unknown) => f.runtime.dispatchFetch(`https://example.com${path}`, { method: "POST", headers: { origin: "https://example.com", cookie: who.cookie, "content-type": "application/json", "x-jazu-work": "1", "x-jazu-csrf": who.csrf }, body: JSON.stringify(body) })
        const pair = await generate_owner_key(), published = await (await api("/api/v1/work/owner-key", owner, { public_jwk: pair.public_jwk })).json() as any
        const rooms = await Promise.all([first, second].map(async who => {
            const id = crypto.randomUUID(), key = random()
            await api("/api/v1/work/rooms", who, { id, key_id: published.key_id, owner_wrap: await wrap_room_key(key, pair.public_jwk, id) })
            const ws = (await f.connect(who.cookie)).webSocket!; ws.accept(); const events = stream(ws); await events.wait(value => value.type === "ready")
            return { id, key, ws, events }
        }))
        const ws = (await f.connect(owner.cookie)).webSocket!; ws.accept(); const events = stream(ws); await events.wait(value => value.type === "ready")
        await Promise.all(rooms.map(room => events.command({ type: "watch", conversation: room.id, after: 0 })))
        await Promise.all(rooms.map(async room => {
            const id = crypto.randomUUID(), envelope = await encrypt_message(room.key, "Concurrent channel delivery", { room: room.id, id, author: "client" })
            const response = await room.events.command({ type: "send", conversation: room.id, id, envelope })
            assert.equal(response.error, undefined)
            await events.wait(value => value.type === "messages" && value.conversation === room.id)
        }))
        ws.close(); for (const room of rooms) room.ws.close()
    } finally { await f.runtime.dispose() }
})
