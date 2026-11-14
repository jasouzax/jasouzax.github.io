import { test } from "node:test"
import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"
import { readFileSync, readdirSync } from "node:fs"
import { push_route, push_deliver, push_endpoint } from "../src/node/push.ts"
import { auth_hash, auth_route } from "../src/node/auth.ts"
import { encode_key, decode_key, encrypt_message, generate_owner_key, wrap_room_key } from "../src/work_crypto.ts"
import { preview_message } from "../src/web/notification_preview.ts"
import type { Work_Env, Work_Statement } from "../src/node/work.ts"
const origin = "https://example.com", random = () => encode_key(crypto.getRandomValues(new Uint8Array(32)))
async function fixture() {
    const db = new DatabaseSync(":memory:")
    for (const file of readdirSync("migrations").filter(file => file.endsWith(".sql")).sort()) db.exec(readFileSync(`migrations/${file}`, "utf8"))
    const vapid = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])
    const private_jwk = await crypto.subtle.exportKey("jwk", vapid.privateKey)
    const env: Work_Env = { GOOGLE_CLIENT_ID: "synthetic.apps.googleusercontent.com", VAPID_PUBLIC_KEY: encode_key(new Uint8Array(await crypto.subtle.exportKey("raw", vapid.publicKey))), VAPID_PRIVATE_KEY: private_jwk.d!, VAPID_SUBJECT: "mailto:owner@example.com", DB: { prepare(sql) {
        let args: any[] = []
        const statement: Work_Statement = { bind(...values) { args = values; return statement }, async first<T>() { return db.prepare(sql).get(...args) as T ?? null }, async all<T>() { return { results: db.prepare(sql).all(...args) as T[] } }, async run() { return db.prepare(sql).run(...args) } }
        return statement
    }, async batch(statements) { db.exec("BEGIN"); try { for (const statement of statements) await statement.run(); db.exec("COMMIT") } catch (error) { db.exec("ROLLBACK"); throw error } } } }
    const token = random(), hash = await auth_hash(token), csrf = await auth_hash(`csrf\n${token}`), now = Date.now()
    db.prepare("INSERT INTO auth_users VALUES ('client', 'client@example.com', 'Client', ?)").run(now)
    db.prepare("INSERT INTO auth_sessions VALUES (?, 'client', ?, ?)").run(hash, now, now)
    const request = (path: string, body?: unknown, extra: Record<string, string> = {}) => new Request(origin + path, { method: body === undefined ? "GET" : "POST", headers: { origin, cookie: `__Host-jazu_session=${token}`, "x-jazu-work": "1", "x-jazu-csrf": csrf, ...extra }, body: body === undefined ? undefined : JSON.stringify(body) })
    const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey"])
    const subscription = { endpoint: "https://fcm.googleapis.com/fcm/send/synthetic-device", expirationTime: null, keys: { p256dh: encode_key(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey))), auth: encode_key(crypto.getRandomValues(new Uint8Array(16))) } }
    return { db, env, request, subscription, hash }
}
test("push subscriptions require verified session, CSRF and real push service keys; logout clears this device", async () => {
    const f = await fixture()
    try {
        for (const endpoint of ["http://fcm.googleapis.com/x", "https://127.0.0.1/x", "https://fcm.googleapis.com.evil.com/x", "https://user@fcm.googleapis.com/x", "https://fcm.googleapis.com:8443/x"]) assert.equal(push_endpoint(endpoint), false)
        assert.equal((await push_route(f.request("/api/v1/push/subscription", { subscription: f.subscription }, { cookie: "" }), f.env)).status, 403)
        assert.equal((await push_route(f.request("/api/v1/push/subscription", { subscription: f.subscription }, { "x-jazu-csrf": "wrong" }), f.env)).status, 403)
        assert.equal((await push_route(f.request("/api/v1/push/subscription", { subscription: { ...f.subscription, endpoint: "https://localhost/private" } }), f.env)).status, 400)
        assert.equal((await push_route(f.request("/api/v1/push/subscription", { subscription: f.subscription }), f.env)).status, 200)
        assert.equal((await push_route(f.request("/api/v1/push/subscription", { subscription: f.subscription }), f.env)).status, 200)
        assert.equal((f.db.prepare("SELECT COUNT(*) AS n FROM push_subscriptions").get() as any).n, 1)
        assert.equal((await auth_route(f.request("/api/v1/auth/logout", {}), f.env)).status, 200)
        assert.equal((f.db.prepare("SELECT COUNT(*) AS n FROM push_subscriptions").get() as any).n, 0)
    } finally { f.db.close() }
})
test("push is encrypted, retries failed devices, removes expired subscriptions, and never delivers twice after acceptance", async () => {
    const f = await fixture()
    try {
        await push_route(f.request("/api/v1/push/subscription", { subscription: f.subscription }), f.env)
        const second = { ...f.subscription, endpoint: "https://web.push.apple.com/synthetic-device" }
        await push_route(f.request("/api/v1/push/subscription", { subscription: second }), f.env)
        const notice = { channel: "work", conversation: crypto.randomUUID(), id: crypto.randomUUID(), sender: "owner@example.com", href: "/work/", created_at: Date.now(), self: false }
        let fail = true, sends = 0
        const upstream: typeof fetch = async (input, options) => {
            sends++; const headers = new Headers(options?.headers)
            assert.equal(headers.get("content-encoding"), "aes128gcm"); assert.match(headers.get("authorization")!, /^vapid t=/)
            assert.equal(options?.redirect, "manual")
            const bytes = new Uint8Array(options!.body as ArrayBuffer)
            assert.equal(bytes.byteLength, 4096); assert.equal(new TextDecoder().decode(bytes).includes(notice.sender), false)
            return new Response(null, { status: String(input).includes("apple") ? 410 : fail ? 503 : 201 })
        }
        await assert.rejects(push_deliver(f.env, "a:client", notice, upstream))
        assert.equal(sends, 2)
        assert.equal((f.db.prepare("SELECT COUNT(*) AS n FROM push_subscriptions").get() as any).n, 1)
        fail = false; await push_deliver(f.env, "a:client", notice, upstream); assert.equal(sends, 3)
        await push_deliver(f.env, "a:client", notice, upstream); assert.equal(sends, 3)
        f.db.prepare("DELETE FROM auth_sessions").run()
        await push_deliver(f.env, "a:client", { ...notice, id: crypto.randomUUID() }, upstream); assert.equal(sends, 3)
    } finally { f.db.close() }
})
test("previews decrypt on the device using non-exportable owner/client keys, and reject another identity", async () => {
    const room = crypto.randomUUID(), id = crypto.randomUUID(), key = random(), owner = await generate_owner_key()
    const owner_wrap = await wrap_room_key(key, owner.public_jwk, room)
    const envelope = await encrypt_message(key, "Decrypted preview 📨 <script>literal text</script>", { room, id, author: "client" })
    const data = { channel: "work", conversation: room, id, sender: "client@example.com", href: "/work/" }
    const upstream: typeof fetch = async () => Response.json({ email: "owner@example.com", owner_wrap, message: { id, author: "client", envelope } })
    const owner_key = await crypto.subtle.importKey("jwk", owner.private_jwk, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveKey"])
    assert.equal(owner_key.extractable, false)
    assert.equal(await preview_message(data, { email: "owner@example.com", role: "owner", key: owner_key }, upstream), "Decrypted preview 📨 <script>literal text</script>")
    const client_key = await crypto.subtle.importKey("raw", decode_key(key), "AES-GCM", false, ["decrypt"])
    assert.equal(await preview_message(data, { email: "owner@example.com", role: "client", room, key: client_key }, upstream), "Decrypted preview 📨 <script>literal text</script>")
    await assert.rejects(preview_message(data, { email: "other@example.com", role: "owner", key: owner_key }, upstream))
    await assert.rejects(preview_message(data, { email: "owner@example.com", role: "client", room: crypto.randomUUID(), key: client_key }, upstream))
})
