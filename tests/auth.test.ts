/* Google OIDC contracts with real RSA verification and real SQL; no external account or Google calls. */
import { test } from "node:test"
import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"
import { readFileSync } from "node:fs"
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from "jose"
import { auth_route, verify_google_token } from "../src/node/auth.ts"
import { work_route, type Work_Env, type Work_Statement } from "../src/node/work.ts"
import { encode_key } from "../src/work_crypto.ts"
import { secure_response } from "../src/node/security.ts"
import worker from "../src/node/worker.ts"

const origin = "https://staging.example.com"
const client_id = "test.apps.googleusercontent.com"
const keys = await generateKeyPair("RS256")
const public_key = await exportJWK(keys.publicKey)
const resolver = createLocalJWKSet({ keys: [{ ...public_key, kid: "test", alg: "RS256" }] })
const cookie_part = (response: Response, name: string) => response.headers.getSetCookie().find(value => value.startsWith(name + "="))?.split(";")[0] ?? ""

async function token(claims: Record<string, unknown> = {}): Promise<string> {
    return new SignJWT({ sub: "google-client", email: "client@example.com", name: "Client", email_verified: true, nonce: "nonce", iss: "https://accounts.google.com", aud: client_id, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300, ...claims }).setProtectedHeader({ alg: "RS256", kid: "test" }).sign(keys.privateKey)
}

function fixture() {
    const db = new DatabaseSync(":memory:")
    for (const file of ["0002_work_chat.sql", "0003_google_auth.sql", "0004_guest_messaging.sql", "0005_profile_images.sql", "0006_unstored_keys.sql", "0007_realtime.sql"]) db.exec(readFileSync(`migrations/${file}`, "utf8"))
    const env: Work_Env = { GOOGLE_CLIENT_ID: client_id, GOOGLE_CLIENT_SECRET: "secret-never-shown-to-browser", GOOGLE_ADMIN_EMAIL: "jason@jasouza.com", DB: { prepare(sql) {
        let values: any[] = []
        const statement: Work_Statement = {
            bind(...args) { values = args; return statement },
            async first<T>() { return db.prepare(sql).get(...values) as T ?? null },
            async all<T>() { return { results: db.prepare(sql).all(...values) as T[] } },
            async run() { return db.prepare(sql).run(...values) },
        }
        return statement
    }, async batch(statements) {
        db.exec("BEGIN")
        try {
            const results = []
            for (const statement of statements) results.push(await statement.run())
            db.exec("COMMIT")
            return results
        } catch (error) { db.exec("ROLLBACK"); throw error }
    } } }
    const request = (path: string, cookie = "", body?: unknown, extra: Record<string, string> = {}) => new Request(origin + path, { method: body === undefined ? "GET" : "POST", headers: { cookie, origin, "content-type": "application/json", "x-jazu-work": "1", ...extra }, body: body === undefined ? undefined : JSON.stringify(body) })
    const start = async () => {
        const response = await auth_route(request("/api/v1/auth/google/start"), env)
        assert.equal(response.status, 302)
        const url = new URL(response.headers.get("location")!)
        assert.equal(url.origin, "https://accounts.google.com")
        assert.equal(url.searchParams.get("redirect_uri"), origin + "/api/v1/auth/google/callback")
        assert.equal(url.searchParams.get("scope"), "openid email profile https://www.googleapis.com/auth/drive.appdata")
        assert.equal(url.searchParams.has("client_secret"), false)
        assert.equal(url.searchParams.get("code_challenge_method"), "S256")
        assert.match(response.headers.get("set-cookie")!, /HttpOnly; Secure; SameSite=Lax/)
        return { url, cookie: cookie_part(response, "__Host-jazu_oauth") }
    }
    const login = async (email: string, subject: string, grant: Record<string, unknown> = {}, picture = "") => {
        const flow = await start()
        const id_token = await token({ email, sub: subject, picture, nonce: flow.url.searchParams.get("nonce") })
        const callback = request(`/api/v1/auth/google/callback?state=${flow.url.searchParams.get("state")}&code=one-use-code`, flow.cookie)
        const response = await auth_route(callback, env, { keys: resolver, fetch: async (input, init) => {
            assert.equal(String(input), "https://oauth2.googleapis.com/token")
            const body = new URLSearchParams(String(init!.body))
            assert.equal(body.get("client_secret"), env.GOOGLE_CLIENT_SECRET)
            assert.equal(body.get("redirect_uri"), origin + "/api/v1/auth/google/callback")
            const challenge = encode_key(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body.get("code_verifier")!))))
            assert.equal(challenge, flow.url.searchParams.get("code_challenge"))
            return Response.json({ id_token, ...grant })
        } })
        assert.equal(response.headers.get("location"), "/work")
        assert.equal(secure_response(response).headers.getSetCookie().length, 2)
        const cookie = cookie_part(response, "__Host-jazu_session")
        assert.ok(cookie)
        const session = await (await auth_route(request("/api/v1/auth/session", cookie), env)).json() as any
        return { cookie, session, callback }
    }
    return { db, env, request, start, login }
}

test("Google JWT verification rejects wrong signatures, issuer/audience/nonce/azp, unverified email and expiry", async () => {
    assert.equal((await verify_google_token(await token(), client_id, "nonce", resolver)).subject, "google-client")
    for (const claims of [{ iss: "https://evil.example" }, { aud: "other-client" }, { azp: "other-client" }, { nonce: "wrong" }, { email_verified: false }, { exp: 1 }, { sub: "" }, { iat: 1 }]) await assert.rejects(verify_google_token(await token(claims), client_id, "nonce", resolver))
    const valid = await token()
    await assert.rejects(verify_google_token(valid.slice(0, -10) + "aaaaaaaaaa", client_id, "nonce", resolver))
})

test("Google callbacks are browser-bound, one-use, and expose useful safe configuration errors", async () => {
    const f = fixture()
    try {
        const flow = await f.start()
        const private_callback = await worker.fetch(f.request("/api/v1/auth/google/callback?code=secret"), { ...f.env, DOMAIN: "staging.example.com", PAGES_ORIGIN: "https://site.pages.dev" })
        assert.equal(private_callback.headers.get("referrer-policy"), "no-referrer")
        assert.equal(private_callback.headers.get("cache-control"), "no-store")
        const path = `/api/v1/auth/google/callback?state=${flow.url.searchParams.get("state")}&code=code`
        const invalid = await auth_route(f.request(path), f.env)
        assert.equal(invalid.headers.get("location"), "/work?auth_error=invalid_state")
        assert.equal((f.db.prepare("SELECT count(*) AS n FROM auth_flows").get() as any).n, 1)
        const failed = await auth_route(f.request(path, flow.cookie), f.env, { fetch: async () => Response.json({ error: "invalid_client" }, { status: 401 }) })
        assert.equal(failed.headers.get("location"), "/work?auth_error=client_configuration")
        assert.equal((await auth_route(f.request(path, flow.cookie), f.env)).headers.get("location"), "/work?auth_error=invalid_state")
        assert.equal((f.db.prepare("SELECT count(*) AS n FROM auth_sessions").get() as any).n, 0)
        const cancel = await f.start()
        assert.equal((await auth_route(f.request(`/api/v1/auth/google/callback?state=${cancel.url.searchParams.get("state")}&error=access_denied`, cancel.cookie), f.env)).headers.get("location"), "/work?auth_error=cancelled")
    } finally { f.db.close() }
})

test("admin identity is pinned; OAuth project ownership alone gives no admin role; sessions require CSRF and revoke on sign-out", async () => {
    const f = fixture()
    try {
        const admin = await f.login("jason@jasouza.com", "google-owner")
        assert.equal(admin.session.user.role, "owner")
        assert.equal((await auth_route(admin.callback, f.env)).headers.get("location"), "/work?auth_error=invalid_state")
        const project_owner = await f.login("jasouzax@gmail.com", "google-project-owner")
        assert.equal(project_owner.session.user.role, "client")
        const different_subject = await f.login("jason@jasouza.com", "another-subject")
        assert.equal(different_subject.session.user.role, "client")
        assert.equal((await work_route(f.request("/api/v1/work/rooms", admin.cookie, { email: "client@example.com" }), f.env)).status, 403)
        const request = f.request("/api/v1/auth/logout", admin.cookie, {}, { "x-jazu-csrf": admin.session.csrf })
        assert.equal((await auth_route(request, f.env)).status, 200)
        const after = await (await auth_route(f.request("/api/v1/auth/session", admin.cookie), f.env)).json() as any
        assert.equal(after.user, null)
        const stored = f.db.prepare("SELECT token_hash FROM auth_sessions").all() as any[]
        assert.ok(stored.every(row => !admin.cookie.includes(row.token_hash)))
    } finally { f.db.close() }
})

test("Drive credentials are sealed per session, require CSRF and refresh without exposing tokens in profiles", async () => {
    const f = fixture()
    try {
        const grant = { access_token: "synthetic-access", refresh_token: "synthetic-refresh", expires_in: 1, scope: "openid email profile https://www.googleapis.com/auth/drive.appdata" }
        const client = await f.login("client@example.com", "drive-client", grant)
        const stored = f.db.prepare("SELECT sealed FROM auth_google_grants").get() as any
        assert.ok(stored)
        assert.equal(stored.sealed.includes(grant.access_token), false)
        assert.equal(stored.sealed.includes(grant.refresh_token), false)
        assert.equal(JSON.stringify(client.session).includes("access_token"), false)
        assert.equal((await auth_route(f.request("/api/v1/auth/drive", client.cookie, {}), f.env)).status, 403)
        const response = await auth_route(f.request("/api/v1/auth/drive", client.cookie, {}, { "x-jazu-csrf": client.session.csrf }), f.env, { fetch: async (input, init) => {
            assert.equal(String(input), "https://oauth2.googleapis.com/token")
            assert.equal(init!.redirect, "manual")
            assert.equal(new URLSearchParams(String(init!.body)).get("refresh_token"), grant.refresh_token)
            return Response.json({ access_token: "refreshed-access", expires_in: 3600 })
        } })
        assert.deepEqual(await response.json(), { access_token: "refreshed-access" })
        assert.equal(response.headers.get("cache-control"), "no-store")
        await auth_route(f.request("/api/v1/auth/logout", client.cookie, {}, { "x-jazu-csrf": client.session.csrf }), f.env)
        assert.equal((f.db.prepare("SELECT count(*) AS n FROM auth_google_grants").get() as any).n, 0)
    } finally { f.db.close() }
})

test("profile images use verified claims or matching Google userinfo and never accept another subject", async () => {
    const f = fixture()
    try {
        const picture = "https://lh3.googleusercontent.com/a/verified-photo"
        const claimed = await f.login("picture@example.com", "photo-claim", {}, picture)
        assert.equal(claimed.session.user.picture, picture)
        const grant = { access_token: "synthetic-profile-access", expires_in: 3600, scope: "openid profile https://www.googleapis.com/auth/drive.appdata" }
        const older = await f.login("older@example.com", "older-subject", grant)
        assert.equal((await auth_route(f.request("/api/v1/auth/profile", older.cookie, {}), f.env)).status, 403)
        const request = f.request("/api/v1/auth/profile", older.cookie, {}, { "x-jazu-csrf": older.session.csrf })
        const mismatch = await auth_route(request, f.env, { fetch: async () => Response.json({ sub: "someone-else", picture }) })
        assert.deepEqual(await mismatch.json(), { picture: "" })
        const matched = await auth_route(request, f.env, { fetch: async (input, init) => {
            assert.equal(String(input), "https://openidconnect.googleapis.com/v1/userinfo")
            assert.equal(init!.redirect, "manual")
            return Response.json({ sub: "older-subject", picture })
        } })
        assert.deepEqual(await matched.json(), { picture })
        assert.equal((await (await auth_route(f.request("/api/v1/auth/session", older.cookie), f.env)).json() as any).user.picture, picture)
    } finally { f.db.close() }
})

test("account deletion requires CSRF and explicit intent, revokes all devices and anonymizes only its linked rooms", async () => {
    const f = fixture()
    try {
        const admin = await f.login("jason@jasouza.com", "owner")
        const client = await f.login("client@example.com", "client")
        const second_device = await f.login("client@example.com", "client")
        const other = await f.login("other@example.com", "other")
        const room = crypto.randomUUID()
        const other_room = crypto.randomUUID()
        f.db.prepare("INSERT INTO work_rooms (id,email,token_hash,created_at,google_subject) VALUES (?, ?, ?, ?, ?)").run(room, "client@example.com", "old-token-hash", Date.now(), "client")
        f.db.prepare("INSERT INTO work_rooms (id,email,token_hash,created_at,google_subject) VALUES (?, ?, ?, ?, ?)").run(other_room, "other@example.com", "other-token-hash", Date.now(), "other")
        f.db.prepare("INSERT INTO work_messages (room_id,id,author,envelope,created_at) VALUES (?, ?, 'client', '{}', ?)").run(room, crypto.randomUUID(), Date.now())
        const path = "/api/v1/auth/account/delete"
        const headers = { "x-jazu-csrf": client.session.csrf, "x-jazu-confirm-delete": "account" }
        assert.equal((await auth_route(f.request(path, "", {}, headers), f.env)).status, 403)
        assert.equal((await auth_route(f.request(path, client.cookie, {}, { "x-jazu-csrf": client.session.csrf }), f.env)).status, 403)
        assert.equal((await auth_route(f.request(path, client.cookie, {}, { ...headers, origin: "https://evil.example" }), f.env)).status, 403)
        const deleted = await auth_route(f.request(path, client.cookie, {}, headers), f.env)
        assert.equal(deleted.status, 200)
        assert.match(deleted.headers.get("set-cookie")!, /Max-Age=0/)
        assert.equal(f.db.prepare("SELECT subject FROM auth_users WHERE subject = 'client'").get(), undefined)
        assert.equal((f.db.prepare("SELECT count(*) AS n FROM auth_sessions WHERE subject = 'client'").get() as any).n, 0)
        assert.equal((await (await auth_route(f.request("/api/v1/auth/session", second_device.cookie), f.env)).json() as any).user, null)
        const closed = f.db.prepare("SELECT * FROM work_rooms WHERE id = ?").get(room) as any
        assert.equal(closed.revoked, 1)
        assert.equal(closed.google_subject, null)
        assert.notEqual(closed.email, "client@example.com")
        assert.match(closed.token_hash, /^deleted:/)
        assert.equal((f.db.prepare("SELECT count(*) AS n FROM work_messages WHERE room_id = ?").get(room) as any).n, 1)
        assert.equal((await work_route(f.request(`/api/v1/work/rooms/${room}`, admin.cookie), f.env)).status, 200)
        assert.equal((await work_route(f.request(`/api/v1/work/rooms/${other_room}`, other.cookie), f.env)).status, 200)
        const admin_delete = await auth_route(f.request(path, admin.cookie, {}, { "x-jazu-csrf": admin.session.csrf, "x-jazu-confirm-delete": "account" }), f.env)
        assert.equal(admin_delete.status, 200)
        assert.equal((f.db.prepare("SELECT count(*) AS n FROM auth_owner").get() as any).n, 0)
        assert.ok(f.db.prepare("SELECT subject FROM auth_users WHERE subject = 'other'").get())
    } finally { f.db.close() }
})

test("account deletion rolls back every change if the transaction fails", async () => {
    const f = fixture()
    try {
        const client = await f.login("client@example.com", "client")
        const room = crypto.randomUUID()
        f.db.prepare("INSERT INTO work_rooms (id,email,token_hash,created_at,google_subject) VALUES (?, 'client@example.com', 'keep-token', ?, 'client')").run(room, Date.now())
        f.db.exec("CREATE TRIGGER reject_delete BEFORE DELETE ON auth_users BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END")
        await assert.rejects(auth_route(f.request("/api/v1/auth/account/delete", client.cookie, {}, { "x-jazu-csrf": client.session.csrf, "x-jazu-confirm-delete": "account" }), f.env))
        assert.equal((f.db.prepare("SELECT revoked FROM work_rooms WHERE id = ?").get(room) as any).revoked, 0)
        assert.equal((await (await auth_route(f.request("/api/v1/auth/session", client.cookie), f.env)).json() as any).user.email, "client@example.com")
    } finally { f.db.close() }
})
