/* Preflight must fail before changing configuration and preserve persistent key material. */
import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { cloud_preflight, persist_generated } from "../../src/step/cloud_preflight.ts"
import { cloud_command } from "../../src/step/cloud.ts"
import type { site_config } from "../../shared/config.ts"

test("online preflight cannot silently become offline deployment preparation", async () => {
    await assert.rejects(cloud_command("unused", { preflight: true, dry_run: true }), /Choose --preflight/)
})

test("cloud preflight discovers one account, checks services and preserves generated secrets", async () => {
    const root = mkdtempSync(join(tmpdir(), "jazu-preflight-")), id = "a".repeat(32), zone = "b".repeat(32)
    const config = { base_url: "https://example.com", owner: { email: "owner@example.com" } } as site_config
    const env = { CLOUDFLARE_API_TOKEN: "synthetic", ORIGIN_HMAC_SECRET: "h".repeat(32), GOOGLE_CLIENT_ID: "client", GOOGLE_CLIENT_SECRET: "secret" } as NodeJS.ProcessEnv
    const request = (async (url: string) => Response.json({ success: true, result: url.endsWith("/tokens/verify") ? { status: "active" } : url.includes("/accounts?") ? [{ id }] : url.includes("/zones?") ? [{ id: zone, name: "example.com" }] : [] })) as typeof fetch
    try {
        await assert.rejects(cloud_preflight(root, config, {}, request), /missing/)
        await cloud_preflight(root, config, env, request)
        const before = readFileSync(join(root, ".env"), "utf8")
        assert.equal(env.CLOUDFLARE_ACCOUNT_ID, id)
        assert.equal(env.TF_VAR_zone_id, zone)
        assert.equal(Buffer.from(env.VAPID_PUBLIC_KEY!, "base64url").length, 65)
        await cloud_preflight(root, config, env, request)
        assert.equal(readFileSync(join(root, ".env"), "utf8"), before)
        await assert.rejects(cloud_preflight(root, config, { ...env, CLOUDFLARE_ACCOUNT_ID: "c".repeat(32) }, request), /accessible/)
        const denied = (async () => new Response("denied", { status: 403 })) as typeof fetch
        await assert.rejects(cloud_preflight(root, config, env, denied), /denied/)
        writeFileSync(join(root, ".env"), 'AUTH_JWT_SECRET="original"\n')
        const isolated: NodeJS.ProcessEnv = {}
        persist_generated(root, { AUTH_JWT_SECRET: "replacement" }, isolated)
        assert.equal(isolated.AUTH_JWT_SECRET, "original")
        assert(!readFileSync(join(root, ".env"), "utf8").includes("replacement"))
    } finally { rmSync(root, { recursive: true, force: true }) }
})

function fixture(t: { after: (cleanup: () => void) => void }) {
    const root = mkdtempSync(join(tmpdir(), "jazu-preflight-")), id = "a".repeat(32), zone = "b".repeat(32)
    t.after(() => rmSync(root, { recursive: true, force: true }))
    const config = { base_url: "https://example.com", owner: { email: "owner@example.com" }, deploy: { worker_name: "synthetic-worker" } } as site_config
    const env: NodeJS.ProcessEnv = { CLOUDFLARE_API_TOKEN: "synthetic", ORIGIN_HMAC_SECRET: "h".repeat(32), GOOGLE_CLIENT_ID: "client", GOOGLE_CLIENT_SECRET: "secret" }
    const request = (async (url: string) => Response.json({ success: true, result: url.endsWith("/tokens/verify") ? { status: "active" } : url.includes("/accounts?") ? [{ id }] : url.includes("/zones?") ? [{ id: zone }] : url.endsWith("/settings") ? { bindings: [{ name: "AUTH_JWT_SECRET", type: "secret_text" }, { name: "VAPID_PRIVATE_KEY", type: "secret_text" }] } : [] })) as typeof fetch
    return { root, config, env, request }
}

test("read-only preflight preserves the restored file and environment, including missing local signing keys", async t => {
    const { root, config, env, request } = fixture(t)
    const source = '# restored file\r\nCLOUDFLARE_API_TOKEN="synthetic"\r\n'
    writeFileSync(join(root, ".env"), source)
    const before = { ...env }
    await cloud_preflight(root, config, env, request, { persist: false })
    assert.equal(readFileSync(join(root, ".env"), "utf8"), source)
    assert.deepEqual(env, before)
    assert(!existsSync(join(root, ".env.generated.tmp")))
})

test("configuration generation cannot replace keys already bound on the deployed Worker", async t => {
    const { root, config, env, request } = fixture(t)
    await assert.rejects(cloud_preflight(root, config, env, request), /existing Worker has AUTH_JWT_SECRET, VAPID_PRIVATE_KEY/)
    assert(!existsSync(join(root, ".env")))
    assert.equal(env.AUTH_JWT_SECRET, undefined)
    assert.equal(env.VAPID_PRIVATE_KEY, undefined)
})

test("only a missing Worker permits fresh keys; inaccessible Worker settings fail closed", async t => {
    const { root, config, env, request } = fixture(t)
    const settings_response = (status: number) => (async (url: string, init?: RequestInit) => url.endsWith("/settings") ? new Response(null, { status }) : request(url, init)) as typeof fetch
    await assert.rejects(cloud_preflight(root, config, env, settings_response(403)), /existing Worker signing keys denied/)
    assert(!existsSync(join(root, ".env")))
    await cloud_preflight(root, config, env, settings_response(404))
    assert(env.AUTH_JWT_SECRET && env.VAPID_PRIVATE_KEY)
})

test("user-owned tokens fall back to user verification; inactive tokens do not change configuration", async t => {
    const { root, config, env, request } = fixture(t)
    const calls: string[] = []
    let status = "disabled"
    const user_token = (async (url: string, init?: RequestInit) => {
        calls.push(url)
        if (url.includes("/accounts/") && url.endsWith("/tokens/verify")) return new Response(null, { status: 401 })
        if (url.endsWith("/user/tokens/verify")) return Response.json({ success: true, result: { status } })
        return request(url, init)
    }) as typeof fetch
    await assert.rejects(cloud_preflight(root, config, env, user_token, { persist: false }), /not active/)
    assert(!existsSync(join(root, ".env")))
    status = "active"
    await cloud_preflight(root, config, env, user_token, { persist: false })
    assert(calls.some(url => url.endsWith("/user/tokens/verify")))
    assert(!existsSync(join(root, ".env")))
})

test("Terraform signing-key aliases are reused without generating new material", async t => {
    const { root, config, env, request } = fixture(t)
    env.TF_VAR_auth_jwt_secret = "j".repeat(32)
    env.TF_VAR_vapid_public_key = "existing-public"
    env.TF_VAR_vapid_private_key = "existing-private"
    await cloud_preflight(root, config, env, request)
    assert.equal(env.AUTH_JWT_SECRET, env.TF_VAR_auth_jwt_secret)
    assert.equal(env.VAPID_PUBLIC_KEY, env.TF_VAR_vapid_public_key)
    assert.equal(env.VAPID_PRIVATE_KEY, env.TF_VAR_vapid_private_key)
})
