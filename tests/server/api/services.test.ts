/* Real Worker/Node/child roundtrips for signed JSON hooks, durable delivery keys and API.open. */
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { createServer } from "node:http"
import { once } from "node:events"
import { createHmac } from "node:crypto"
import { build } from "esbuild"
import { Miniflare, convertV4MiniflareOptions } from "miniflare"
import { Api_Manager } from "../../../server/api/manager.ts"
import { Runtime_API } from "../../../server/api/runtime.ts"
import { personal_server } from "../../../server/repo/index.ts"

test("hooks verify exact bytes before replay, outbound delivery retries/deduplicates, and API.open stays isolated", { timeout: 30000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), "api-services-")), manager = new Api_Manager(join(root, "state"), resolve("server/api/child.ts")), secret = "s".repeat(40), hook_secret = "h".repeat(32)
    const origin = personal_server({ secret, repositories: {}, port: 0, apis: manager })
    await once(origin, "listening")
    const origin_url = `http://127.0.0.1:${(origin.address() as any).port}`
    const bundle = await build({ entryPoints: ["cloud/router/index.ts"], bundle: true, write: false, format: "esm", platform: "browser" })
    const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: "2026-11-04", bindings: { DOMAIN: "example.com", PAGES_ORIGIN: "https://pages.example.com", PERSONAL_ORIGIN: origin_url, ORIGIN_HMAC_SECRET: secret }, outboundService: async request => fetch(new Request(new URL(new URL(request.url).pathname, origin_url), { method: request.method, headers: Object.fromEntries(request.headers), body: await request.text() })) }))
    let retry_calls = 0, leaked = 0
    const bridge = createServer(async (incoming, outgoing) => {
        if (incoming.url === "/retry") { retry_calls++; outgoing.writeHead(retry_calls === 1 ? 503 : 200, { "content-type": "application/json" }); outgoing.end('{"accepted":true}'); return }
        if (incoming.url === "/redirect" || incoming.url === "/api/hooks/v1/redirect") { outgoing.writeHead(302, { location: "/leak" }); outgoing.end(); return }
        if (incoming.url === "/leak") { leaked++; outgoing.end("leaked"); return }
        try {
            const chunks = []; for await (const chunk of incoming) chunks.push(chunk)
            const headers = Object.fromEntries(Object.entries(incoming.headers).filter(([, value]) => typeof value === "string")) as Record<string, string>
            const response = await runtime.dispatchFetch(`https://example.com${incoming.url}`, { method: incoming.method, headers, ...(["GET", "HEAD"].includes(incoming.method!) ? {} : { body: Buffer.concat(chunks).toString() }) })
            outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(new Uint8Array(await response.arrayBuffer()))
        } catch { outgoing.writeHead(500); outgoing.end() }
    }).listen(0, "127.0.0.1")
    await once(bridge, "listening")
    const public_url = `http://127.0.0.1:${(bridge.address() as any).port}`, previous_secret = process.env.API_TEST_HOOK, previous_origin = process.env.API_TEST_ORIGIN
    process.env.API_TEST_HOOK = hook_secret; process.env.API_TEST_ORIGIN = public_url
    let sender = new Runtime_API({ id: "sender", version: 1 }, root)
    try {
        const source = join(root, "hooks.auto.js")
        writeFileSync(source, `const api=new API({id:'hooks',version:1,access:'public',secrets:['API_TEST_HOOK','API_TEST_ORIGIN']});
const {createHmac,timingSafeEqual}=require('node:crypto');
api.hook('/incoming',{idempotent:true,headers:['x-hook-signature'],verify:ctx=>{const expected='sha256='+createHmac('sha256',api.secret('API_TEST_HOOK')).update(ctx.raw_body).digest('hex'); const actual=ctx.headers['x-hook-signature']||'';return actual.length===expected.length&&timingSafeEqual(Buffer.from(actual),Buffer.from(expected));}},ctx=>{const count=(api.store.get('count')||0)+1;api.store.set('count',count);return {count,body:ctx.body,undeclared:ctx.headers['x-not-declared']||null}});
api.get('/count',()=>({count:api.store.get('count')||0}));api.query('/search',ctx=>ctx.body);
const client=API.open('hooks',1,{origin:api.secret('API_TEST_ORIGIN')});api.get('/proxy',()=>client.get('/count'));`)
        await manager.deploy(source)
        const client = Runtime_API.open("hooks", 1, { origin: public_url, token: "synthetic-service-token" })
        const delivered = await sender.webhook.send(public_url + "/api/hooks/v1/incoming", { b: 2, a: 1 }, { key: "event-1", headers: { "x-not-declared": "must not forward" }, signature: { secret: hook_secret } })
        assert.equal(delivered.status, 200); assert.equal((delivered.body as any).data.count, 1); assert.equal((delivered.body as any).data.undeclared, null)
        sender.close(); sender = new Runtime_API({ id: "sender", version: 1 }, root); sender.activate()
        const repeated = await sender.webhook.send(public_url + "/api/hooks/v1/incoming", { a: 1, b: 2 }, { key: "event-1", signature: { secret: hook_secret } })
        assert.deepEqual(repeated, delivered)
        assert.deepEqual(await client.get("/proxy"), { count: 1 })
        assert.deepEqual(await client.query("/search", { query: "日本語" }), { query: "日本語" })
        const raw = '{ "b": 2, "a": 1 }', signature = "sha256=" + createHmac("sha256", hook_secret).update(raw).digest("hex")
        const send = (signature_value: string) => fetch(public_url + "/api/hooks/v1/incoming", { method: "POST", headers: { "content-type": "application/json", "x-hook-signature": signature_value, "idempotency-key": "raw-event" }, body: raw })
        assert.equal((await send(signature)).status, 200)
        assert.equal((await send("invalid")).status, 403, "cached replies still require a valid signature")
        assert.equal((await send(signature)).status, 200)
        assert.deepEqual(await client.get("/count"), { count: 2 })
        assert.equal((await sender.webhook.send(public_url + "/retry", { value: 1 }, { key: "retry" })).status, 200); assert.equal(retry_calls, 2)
        await assert.rejects(sender.webhook.send(public_url + "/redirect", {}, { key: "redirect", headers: { authorization: "Bearer private" } }), /refused a redirect/)
        await assert.rejects(client.get("/redirect"), /refused a redirect/)
        assert.equal(leaked, 0)
    } finally {
        sender.close(); await manager.close(); await runtime.dispose()
        await Promise.all([bridge, origin].map(server => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections() })))
        if (previous_secret === undefined) delete process.env.API_TEST_HOOK; else process.env.API_TEST_HOOK = previous_secret
        if (previous_origin === undefined) delete process.env.API_TEST_ORIGIN; else process.env.API_TEST_ORIGIN = previous_origin
        rmSync(root, { recursive: true, force: true })
    }
})
