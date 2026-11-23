/* Security policy runs on real SQLite with synthetic identities; real authenticator signatures use the browser suite. */
import { test } from "node:test"
import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"
import { readFileSync } from "node:fs"
import { auth_hash, auth_route, read_session } from "../../../cloud/api/auth.ts"
import { recent_auth } from "../../../cloud/api/auth/passkey.ts"
import { is_owner } from "../../../cloud/api/server.ts"
import type { Work_Env, Work_Statement } from "../../../cloud/api/work.ts"

async function fixture() {
    const db = new DatabaseSync(":memory:")
    for (const name of ["0002_work_chat", "0003_google_auth", "0004_guest_messaging", "0005_profile_images", "0006_unstored_keys", "0007_realtime", "0008_push", "0009_passkeys"]) db.exec(readFileSync(`cloud/db/migrations/${name}.sql`, "utf8"))
    const token = "r".repeat(43), hash = await auth_hash(token), now = Date.now()
    db.prepare("INSERT INTO auth_users VALUES ('one', 'one@example.com', 'One', ?), ('two', 'two@example.com', 'Two', ?)").run(now, now)
    db.prepare("INSERT INTO auth_sessions VALUES (?, 'one', ?, ?)").run(hash, now, now)
    db.exec("INSERT INTO auth_owner VALUES (1, 'one')")
    const env: Work_Env = { DB: {
        prepare(sql) {
            let values: any[] = []
            const statement: Work_Statement = { bind(...args) { values = args; return statement }, async first<T>() { return db.prepare(sql).get(...values) as T ?? null }, async all<T>() { return { results: db.prepare(sql).all(...values) as T[] } }, async run() { return db.prepare(sql).run(...values) } }
            return statement
        }, async batch(statements) {
            db.exec("BEGIN")
            try { const results = []; for (const statement of statements) results.push(await statement.run()); db.exec("COMMIT"); return results }
            catch (error) { db.exec("ROLLBACK"); throw error }
        },
    } }
    const csrf = await auth_hash(`csrf\n${token}`)
    const request = (path: string, body?: unknown, headers: Record<string, string> = {}) => new Request(`https://example.com/api/_/auth/${path}`, { method: body === undefined ? "GET" : "POST", headers: { cookie: `__Host-jazu_session=${token}`, origin: "https://example.com", "x-jazu-work": "1", "x-jazu-csrf": csrf, "content-type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    const add_key = (id = "key", subject = "one") => db.prepare("INSERT INTO auth_passkeys VALUES (?, ?, 'not-a-public-key', 0, '[]', 'Test', ?)").run(id, subject, Date.now())
    return { db, env, hash, request, add_key }
}
test("passkeys require session/CSRF, restrict owner authority and use recent proof per device", async () => {
    const f = await fixture()
    try {
        assert.equal((await auth_route(f.request("passkeys/register/options", {}, { "x-jazu-csrf": "wrong" }), f.env)).status, 403)
        assert.equal((await auth_route(f.request("passkeys/register/options", {}, { origin: "https://evil.example" }), f.env)).status, 403)
        const session = (await read_session(f.request("passkeys"), f.env))!
        assert.equal(session.role, "owner")
        assert(await recent_auth(f.request("passkeys"), f.env, session))
        f.db.exec("UPDATE auth_sessions SET created_at = 1")
        assert.equal((await auth_route(f.request("passkeys/register/options", {}), f.env)).status, 403)
        f.add_key()
        assert.equal(await is_owner(f.request("passkeys"), { ...f.env, SERVER_OWNER_EMAILS: "one@example.com" }), false)
        assert.equal((await read_session(f.request("passkeys"), f.env))!.role, "client")
        assert.equal((await read_session(f.request("passkeys"), f.env))!.step_up, true)
        assert.equal((await auth_route(f.request("passkeys/remove", { id: "key" }), f.env)).status, 403)
        f.db.prepare("INSERT INTO auth_stepups VALUES (?, ?)").run(f.hash, Date.now())
        assert.equal((await read_session(f.request("passkeys"), f.env))!.role, "owner")
        assert.equal(await is_owner(f.request("passkeys"), { ...f.env, SERVER_OWNER_EMAILS: "one@example.com" }), true)
        assert(await recent_auth(f.request("passkeys"), f.env, session))
        f.add_key("other", "two")
        assert.equal((await auth_route(f.request("passkeys/remove", { id: "other" }), f.env)).status, 404)
        const status = await (await auth_route(f.request("passkeys"), f.env)).json() as any
        assert.deepEqual(status.keys.map((key: any) => key.id), ["key"])
        assert.equal(JSON.stringify(status).includes("public_key"), false)
        f.db.exec("UPDATE auth_stepups SET verified_at = 1")
        assert.equal(await recent_auth(f.request("passkeys"), f.env, session), false)
    } finally { f.db.close() }
})
test("challenges expire, bind the session and purpose, and are consumed even when verification fails", async () => {
    const f = await fixture()
    try {
        const options = await auth_route(f.request("passkeys/register/options", {}), f.env)
        assert.equal(options.status, 200)
        const body = await options.json() as any
        assert.equal(body.rp.id, "example.com")
        assert.equal(body.authenticatorSelection.userVerification, "required")
        const challenge = f.db.prepare("SELECT challenge FROM auth_passkey_challenges").get() as any
        assert.equal(challenge.challenge, body.challenge)
        assert.equal((await auth_route(f.request("passkeys/register", { credential: {} }), f.env)).status, 400)
        assert.equal((f.db.prepare("SELECT count(*) AS n FROM auth_passkey_challenges").get() as any).n, 0)
        assert.equal((await auth_route(f.request("passkeys/register", { credential: {} }), f.env)).status, 400)
        f.add_key()
        await auth_route(f.request("passkeys/verify/options", {}), f.env)
        f.db.exec("UPDATE auth_passkey_challenges SET expires_at = 1")
        assert.equal((await auth_route(f.request("passkeys/verify", { credential: { id: "key" } }), f.env)).status, 400)
        assert.equal((f.db.prepare("SELECT count(*) AS n FROM auth_stepups").get() as any).n, 0)
        f.db.prepare("INSERT INTO auth_stepups VALUES (?, ?)").run(f.hash, Date.now())
        f.db.prepare("DELETE FROM auth_sessions WHERE token_hash = ?").run(f.hash)
        assert.equal((f.db.prepare("SELECT count(*) AS n FROM auth_stepups").get() as any).n, 0)
        assert.equal((await auth_route(f.request("passkeys"), f.env)).status, 401)
    } finally { f.db.close() }
})
