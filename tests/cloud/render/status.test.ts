/* ESR caches public origin structure by revision and never poisons a good snapshot on refresh failure. */
import { test } from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { Public_Renderer } from "../../../cloud/render/status.ts"
import { public_status_route, status_revision } from "../../../server/render/status.ts"
import { verify_origin } from "../../../shared/sign.ts"
import { fill_status, status_data } from "../../../shared/render/status.ts"
import { route, type worker_env } from "../../../cloud/router/index.ts"
import { personal_server } from "../../../server/repo/index.ts"
import { once } from "node:events"
import type { AddressInfo } from "node:net"
import { sign_origin } from "../../../shared/sign.ts"

const secret = "s".repeat(64)
function fixture() {
    const data = new Map<string, unknown>(), paths: string[] = []
    let clock = Date.now(), offline = false, broken = false
    const store = { get: async <T>(key: string) => data.get(key) as T | undefined, put: async (key: string, value: unknown) => { data.set(key, value) } }
    const upstream = async (request: Request): Promise<Response> => {
        paths.push(new URL(request.url).pathname)
        assert(await verify_origin(request, secret, new Map()))
        assert.equal(request.headers.get("cookie"), null)
        assert.equal(request.headers.get("authorization"), null)
        assert.equal(request.headers.get("CF-Access-Client-Id"), "access-id")
        if (offline) throw new Error("Offline")
        if (broken && request.url.endsWith("/template")) return Response.json({ revision: status_revision, html: "corrupted structure" })
        return (await public_status_route(request, async () => ({ text: "CPU: public\nMemory: 4 GiB <script>alert(1)</script>", taken_at: clock })))!
    }
    const renderer = () => new Public_Renderer(store, { PERSONAL_ORIGIN: "https://personal-server.example.com", ORIGIN_HMAC_SECRET: secret, ACCESS_CLIENT_ID: "access-id", ACCESS_CLIENT_SECRET: "access-secret" }, upstream, () => clock)
    return { renderer, data, paths, advance: (ms: number) => { clock += ms }, offline: (value: boolean) => { offline = value }, broken: () => { broken = true } }
}

test("origin SSR exposes bounded public fields and an immutable template revision", async () => {
    const template = await (await public_status_route(new Request("https://node/render/server/template")))!.json()
    assert.equal(createHash("sha256").update(template.html).digest("hex"), template.revision)
    const data = await (await public_status_route(new Request("https://node/render/server/data"), async () => ({ text: "x".repeat(9000), taken_at: 1000 })))!.json()
    assert.deepEqual(Object.keys(data), ["revision", "text", "taken_at"])
    assert.equal(data.text.length, 8192)
    assert.equal((await public_status_route(new Request("https://node/render/server/data", { method: "POST" })))!.status, 405)
    assert.equal(await public_status_route(new Request("https://node/unknown")), null)
})

test("real origin HTTP requires HMAC authentication for both render endpoints", async t => {
    const server = personal_server({ secret, repositories: {}, port: 0 })
    t.after(() => { server.closeAllConnections(); return new Promise<void>(resolve => server.close(() => resolve())) })
    await once(server, "listening")
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    for (const path of ["template", "data"]) {
        const request = new Request(`${origin}/render/server/${path}`)
        assert.equal((await fetch(request)).status, 401)
        const signed = new Request(request, { headers: await sign_origin(request, secret, "public-render") })
        const response = await fetch(signed)
        assert.equal(response.status, 200)
        assert.equal((await response.json()).revision, status_revision)
    }
})

test("durable rendering fetches structure once, refreshes JSON each minute and rehydrates cached markup", async () => {
    const f = fixture(), renderer = f.renderer()
    const first = await renderer.render()
    assert.equal(first?.stale, false)
    assert(first?.html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"))
    assert(!first?.html.includes("<script>"))
    assert.deepEqual(f.paths, ["/render/server/data", "/render/server/template"])
    await renderer.render()
    assert.equal(f.paths.length, 2)
    f.advance(61000)
    await f.renderer().render()
    assert.deepEqual(f.paths, ["/render/server/data", "/render/server/template", "/render/server/data"])
    f.advance(61000); f.offline(true)
    const stale = await f.renderer().render()
    assert.equal(stale?.stale, true)
    assert(stale?.html.includes("Cached server snapshot"))
    const count = f.paths.length
    assert.equal((await f.renderer().render())?.stale, true)
    assert.equal(f.paths.length, count)
    f.advance(61000); f.offline(false)
    assert.equal((await f.renderer().render())?.stale, false)
})

test("invalid templates and unavailable fresh origins preserve the static fallback", async () => {
    const f = fixture(); f.broken()
    assert.equal(await f.renderer().render(), null)
    assert(!f.data.has("public-render:server"))
    assert.equal(status_data({ revision: status_revision, text: "private".repeat(2000), taken_at: 1 }), null)
    assert.equal(status_data({ revision: status_revision, text: "text", taken_at: Infinity }), null)
    assert(!fill_status("<pre>{{text}}</pre>", { revision: status_revision, text: '<a href="evil">', taken_at: 1 }, false).html.includes('<a href="evil">'))
})

test("Worker inserts public rendering in HTML and SPA JSON without forwarding visitor credentials", async () => {
    const f = fixture(), rendered = (await f.renderer().render())!
    const env: worker_env = { DOMAIN: "example.com", PAGES_ORIGIN: "https://pages.example.net", SERVER_HUB: {
        idFromName: name => name,
        get: () => ({ fetch: async request => {
            assert.equal(request.headers.get("x-jazu-role"), "worker")
            assert.equal(request.headers.get("cookie"), null)
            return Response.json(rendered)
        } }),
    } }
    const pages = async (request: Request) => {
        assert.equal(request.headers.get("cookie"), null)
        assert.equal(request.headers.get("authorization"), null)
        assert.equal(request.headers.get("if-none-match"), null)
        return request.url.endsWith(".json") ? Response.json({ main: ["div", {}, ["div", { class: "server_public_render", "data-server-render": "" }, ["p", {}, "Offline"]]] })
            : new Response('<main><div class="server_public_render" data-server-render=""><p>Offline</p></div></main>', { headers: { "content-type": "text/html", etag: '"static"' } })
    }
    const headers = { cookie: "jazu_session=private", authorization: "Bearer private", "if-none-match": '"old"' }
    const html = await route(new Request("https://example.com/server", { headers }), env, pages)
    assert.equal(html.headers.get("x-jazu-render"), "fresh")
    assert.equal(html.headers.get("etag"), null)
    assert((await html.text()).includes("Live server snapshot"))
    const head = await route(new Request("https://example.com/server", { method: "HEAD", headers }), env, pages)
    assert.equal(head.headers.get("x-jazu-render"), "fresh")
    assert.equal(await head.text(), "")
    const json = await route(new Request("https://example.com/ja/server/index.json", { headers }), env, pages)
    const source = JSON.stringify(await json.json())
    assert(source.includes("Live server snapshot"))
    assert(source.includes("<script>alert(1)</script>")) // Inert serialized text, never HTML.
    const fallback = await route(new Request("https://example.com/server"), { ...env, SERVER_HUB: undefined }, pages)
    assert((await fallback.text()).includes("Offline"))
})
