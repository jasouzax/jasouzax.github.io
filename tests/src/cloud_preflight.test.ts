/* Preflight must fail before changing configuration and preserve persistent key material. */
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { cloud_preflight, persist_generated } from "../../src/step/cloud_preflight.ts"
import type { site_config } from "../../shared/config.ts"

test("cloud preflight discovers one account, checks services and preserves generated secrets", async () => {
    const root = mkdtempSync(join(tmpdir(), "jazu-preflight-")), id = "a".repeat(32), zone = "b".repeat(32)
    const config = { base_url: "https://example.com", owner: { email: "owner@example.com" } } as site_config
    const env = { CLOUDFLARE_API_TOKEN: "synthetic", ORIGIN_HMAC_SECRET: "h".repeat(32), GOOGLE_CLIENT_ID: "client", GOOGLE_CLIENT_SECRET: "secret" } as NodeJS.ProcessEnv
    const request = (async (url: string) => Response.json({ success: true, result: url.includes("/accounts?") ? [{ id }] : url.includes("/zones?") ? [{ id: zone, name: "example.com" }] : [] })) as typeof fetch
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
