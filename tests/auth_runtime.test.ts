/* Exercise the actual edge fetch implementation, not Node's more permissive Request. */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { build } from "esbuild"
import { Miniflare, convertV4MiniflareOptions } from "miniflare"
import { generateKeyPair, exportJWK, SignJWT } from "jose"

test("edge callback exchanges tokens, verifies identity, sets a session and refuses redirects", async () => {
    const keys = await generateKeyPair("RS256")
    const jwk = { ...await exportJWK(keys.publicKey), kid: "runtime-test", alg: "RS256" }
    const bundle = await build({ stdin: { contents: 'import {auth_route} from "./src/node/auth.ts"; export default {fetch:auth_route}', resolveDir: process.cwd() }, bundle: true, write: false, format: "esm", platform: "browser", target: "es2022" })
    let calls = 0
    let redirect = false
    let id_token = ""
    const runtime = new Miniflare(convertV4MiniflareOptions({
        modules: true, script: bundle.outputFiles[0].text, compatibilityDate: "2026-11-04",
        bindings: { GOOGLE_CLIENT_ID: "test.apps.googleusercontent.com", GOOGLE_CLIENT_SECRET: "synthetic-secret", GOOGLE_ADMIN_EMAIL: "jason@jasouza.com" },
        d1Databases: ["DB"],
        outboundService: async request => {
            if (request.url === "https://www.googleapis.com/oauth2/v3/certs") return Response.json({ keys: [jwk] })
            calls++
            assert.equal(request.url, "https://oauth2.googleapis.com/token")
            assert.equal(request.method, "POST")
            assert.equal((await request.formData()).get("client_secret"), "synthetic-secret")
            return redirect ? new Response(null, { status: 307, headers: { location: "https://untrusted.example/" } }) : id_token ? Response.json({ id_token }) : Response.json({ error: "invalid_grant" }, { status: 400 })
        },
    }))
    try {
        const db = await runtime.getD1Database("DB")
        for (const file of ["0002_work_chat.sql", "0003_google_auth.sql"]) {
            // D1 exec accepts one SQL statement per line.
            await db.exec(readFileSync(`migrations/${file}`, "utf8").replace(/--[^\n]*/g, "").split(";").map(sql => sql.trim().replace(/\s+/g, " ")).filter(Boolean).join(";\n"))
        }
        for (const redirects of [false, true]) {
            redirect = redirects
            const start = await runtime.dispatchFetch("https://staging.example.com/api/v1/auth/google/start", { redirect: "manual" })
            const state = new URL(start.headers.get("location")!).searchParams.get("state")
            const cookie = start.headers.get("set-cookie")!.split(";")[0]
            const callback = await runtime.dispatchFetch(`https://staging.example.com/api/v1/auth/google/callback?state=${state}&code=synthetic-code`, { redirect: "manual", headers: { cookie } })
            assert.equal(callback.headers.get("location"), "/work?auth_error=token_exchange")
        }
        assert.equal(calls, 2, "redirects must never receive the authorization code or client secret")
        assert.equal((await db.prepare("SELECT count(*) AS n FROM auth_sessions").first<{ n: number }>())!.n, 0)
        redirect = false
        const start = await runtime.dispatchFetch("https://staging.example.com/api/v1/auth/google/start", { redirect: "manual" })
        const authorize = new URL(start.headers.get("location")!)
        id_token = await new SignJWT({ email: "jason@jasouza.com", email_verified: true, nonce: authorize.searchParams.get("nonce"), name: "Owner" }).setProtectedHeader({ alg: "RS256", kid: jwk.kid }).setIssuer("https://accounts.google.com").setAudience("test.apps.googleusercontent.com").setSubject("synthetic-owner").setIssuedAt().setExpirationTime("5m").sign(keys.privateKey)
        const callback = await runtime.dispatchFetch(`https://staging.example.com/api/v1/auth/google/callback?state=${authorize.searchParams.get("state")}&code=synthetic-code`, { redirect: "manual", headers: { cookie: start.headers.get("set-cookie")!.split(";")[0] } })
        assert.equal(callback.headers.get("location"), "/work")
        const cookie = callback.headers.getSetCookie().find(value => value.startsWith("__Host-jazu_session="))!.split(";")[0]
        const session = await runtime.dispatchFetch("https://staging.example.com/api/v1/auth/session", { headers: { cookie } })
        assert.deepEqual((await session.json() as any).user, { email: "jason@jasouza.com", name: "Owner", role: "owner" })
    } finally { await runtime.dispose() }
})
