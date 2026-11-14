/* Actual workerd/D1 encryption and server-to-Google handoff, using synthetic accounts. */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { build } from "esbuild"
import { Miniflare, convertV4MiniflareOptions } from "miniflare"
import { auth_hash } from "../src/node/auth.ts"
import { encode_key, generate_owner_key, wrap_room_key } from "../src/work_crypto.ts"

test("edge fallback survives a new session and is removed only after verified private Drive storage", async () => {
    const token = encode_key(crypto.getRandomValues(new Uint8Array(32))), secret = encode_key(crypto.getRandomValues(new Uint8Array(32)))
    const pair = await generate_owner_key(), room = crypto.randomUUID(), raw = encode_key(crypto.getRandomValues(new Uint8Array(32)))
    const client = { room, key: raw, key_id: await auth_hash(JSON.stringify(pair.public_jwk)), owner_wrap: await wrap_room_key(raw, pair.public_jwk, room) }
    const source = `import {work_route} from "./src/node/work.ts"; import {save_google_grant} from "./src/node/google_grant.ts";
        export default {async fetch(request,env){if(new URL(request.url).pathname==="/seed-grant"){await save_google_grant(env,${JSON.stringify(token)},{access_token:"synthetic-access",expires_in:3600,scope:"https://www.googleapis.com/auth/drive.appdata"});return Response.json({});}return work_route(request,env)}}`
    const bundle = await build({ stdin: { contents: source, resolveDir: process.cwd() }, bundle: true, write: false, format: "esm", platform: "browser", target: "es2022" })
    let uploaded = false
    const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: "2026-11-04", bindings: { GOOGLE_CLIENT_ID: "test.apps.googleusercontent.com", WORK_FALLBACK_KEY: secret }, d1Databases: ["DB"], outboundService: async request => {
        assert.equal(request.url, "https://www.googleapis.com/drive/v3/files/private-file-id?alt=media")
        assert.equal(request.headers.get("authorization"), "Bearer synthetic-access")
        return uploaded ? Response.json({ v: 2, client }) : Response.json({}, { status: 404 })
    } }))
    try {
        const db = await runtime.getD1Database("DB")
        for (const name of ["0002_work_chat.sql", "0003_google_auth.sql", "0004_guest_messaging.sql", "0005_profile_images.sql", "0006_unstored_keys.sql", "0007_realtime.sql"]) await db.exec(readFileSync(`migrations/${name}`, "utf8").replace(/--[^\n]*/g, "").split(";").map(sql => sql.trim().replace(/\s+/g, " ")).filter(Boolean).join(";\n"))
        const now = Date.now(), hash = await auth_hash(token), csrf = await auth_hash(`csrf\n${token}`)
        await db.prepare("INSERT INTO auth_users VALUES ('client-subject','client@example.com','Client',?)").bind(now).run()
        await db.prepare("INSERT INTO auth_sessions VALUES (?,'client-subject',?,?)").bind(hash, now, now).run()
        const api = (body: unknown, credential = token, protection = csrf) => runtime.dispatchFetch("https://example.com/api/v1/work/unstored-key", { method: "POST", headers: { origin: "https://example.com", cookie: `__Host-jazu_session=${credential}`, "x-jazu-work": "1", "x-jazu-csrf": protection, "content-type": "application/json" }, body: JSON.stringify(body) })
        assert.equal((await api({ action: "save", client })).status, 200)
        const stored = await db.prepare("SELECT sealed FROM unstored_keys").first<{ sealed: string }>()
        assert.equal(stored!.sealed.includes(raw), false)
        const next_token = encode_key(crypto.getRandomValues(new Uint8Array(32)))
        await db.prepare("INSERT INTO auth_sessions VALUES (?,'client-subject',?,?)").bind(await auth_hash(next_token), now, now).run()
        assert.equal(((await (await api({ action: "load" }, next_token, await auth_hash(`csrf\n${next_token}`))).json()) as any).client.key, raw)
        await db.prepare("INSERT INTO work_key_files VALUES ('client-subject','private-file-id')").run()
        await runtime.dispatchFetch("https://example.com/seed-grant")
        assert.equal((await api({ action: "drive" })).status, 409)
        assert.ok(await db.prepare("SELECT sealed FROM unstored_keys").first())
        uploaded = true
        assert.equal((await api({ action: "drive" })).status, 200)
        assert.equal(await db.prepare("SELECT sealed FROM unstored_keys").first(), null)
        assert.equal((await api({ action: "save", client })).status, 409)
    } finally { await runtime.dispose() }
})
