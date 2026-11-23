/* Actual workerd and a SQLite Durable Object exercise SSR assembly and stale offline fallback. */
import { test } from "node:test"
import assert from "node:assert/strict"
import { build } from "esbuild"
import { Miniflare, convertV4MiniflareOptions } from "miniflare"
import { public_status_route } from "../../../server/render/status.ts"
import { verify_origin } from "../../../shared/sign.ts"

test("workerd serves fresh and cached public HTML through the real Durable Object", async () => {
    const bundle = await build({ stdin: { contents: `
        import router, {Server_Hub as Hub} from "./cloud/router/index.ts";
        let offset=0;
        export class Server_Hub extends Hub { constructor(ctx,env) { super(ctx,env,{now:()=>Date.now()+offset}); } }
        export default { fetch(request,env) {
            if(new URL(request.url).pathname==="/__test_tick") { offset+=61000; return new Response("advanced"); }
            return router.fetch(request,env);
        } };`, resolveDir: process.cwd() }, bundle: true, write: false, format: "esm", platform: "browser", target: "es2022" })
    const secret = "synthetic-public-render-secret-32-characters"
    let offline = false, templates = 0, snapshots = 0
    const runtime = new Miniflare(convertV4MiniflareOptions({
        modules: true, script: bundle.outputFiles[0].text, compatibilityDate: "2026-11-04",
        bindings: { DOMAIN: "example.com", PAGES_ORIGIN: "https://pages.example.net", PERSONAL_ORIGIN: "https://personal-server.example.net", ORIGIN_HMAC_SECRET: secret },
        durableObjects: { SERVER_HUB: { className: "Server_Hub", useSQLite: true } },
        outboundService: async request => {
            if (new URL(request.url).hostname === "pages.example.net") {
                assert.equal(request.headers.get("cookie"), null)
                return new Response('<main><div class="server_public_render" data-server-render=""><p>Static fallback</p></div></main>', { headers: { "content-type": "text/html" } })
            }
            assert.equal(new URL(request.url).hostname, "personal-server.example.net")
            assert(await verify_origin(new Request(request.url, { headers: Object.fromEntries(request.headers) }), secret, new Map()))
            if (request.url.endsWith("/template")) templates++
            else snapshots++
            if (offline) return new Response(null, { status: 503 })
            return (await public_status_route(new Request(request.url), async () => ({ text: "CPU: Test device\nMemory: 1 GiB", taken_at: Date.now() })))!
        },
    }))
    try {
        const fresh = await runtime.dispatchFetch("https://example.com/server", { headers: { cookie: "private=session" } })
        assert.equal(fresh.status, 200)
        assert.equal(fresh.headers.get("x-jazu-render"), "fresh")
        assert((await fresh.text()).includes("CPU: Test device"))
        assert.equal(templates, 1)
        offline = true
        await runtime.dispatchFetch("https://example.com/__test_tick")
        const stale = await runtime.dispatchFetch("https://example.com/server")
        assert.equal(stale.headers.get("x-jazu-render"), "stale")
        assert((await stale.text()).includes("Cached server snapshot"))
        assert.equal(templates, 1)
        assert.equal(snapshots, 2)
        await runtime.dispatchFetch("https://example.com/server")
        assert.equal(snapshots, 2, "offline requests are throttled for a minute")
    } finally { await runtime.dispose() }
})
