/* Real workerd/D1/WebSocket coverage; no external accounts or network calls. */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { build } from "esbuild"
import { Miniflare, convertV4MiniflareOptions } from "miniflare"
import { auth_hash } from "../src/node/auth.ts"
import { encode_key } from "../src/work_crypto.ts"

const random = () => encode_key(crypto.getRandomValues(new Uint8Array(32)))
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
