/* Worker side of /server: owner gate, edge-cached public status, agent signature, and the /api/{name} gateway's header and sandbox rules. */
import { test } from "node:test"
import assert from "node:assert/strict"
import { gateway_route, gateway_target, server_route, type Edge_Cache, type Server_Env } from "../cloud/api/server.ts"
import { route, type worker_env } from "../cloud/router/index.ts"
import { sign_origin } from "../cloud/security/headers.ts"
import { agent_client_id } from "../shared/protocol/wire.ts"

const token = "A".repeat(43)
const cookie = `__Host-jazu_session=${token}`
const db = (email: string) => ({ prepare: () => ({ bind: () => ({ first: async () => ({ subject: "s1", email, name: "N", picture: null, last_seen: Date.now(), owner_subject: "s1" }), run: async () => ({}), all: async () => ({ results: [] }) }) }) }) as any
type Seen = { path: string, role: string | null, body: string, headers: Headers }
function hub_env(extra: Partial<Server_Env> = {}, reply: (path: string) => Response = path => path === "/status" ? Response.json({ online: true, snapshot: { text: "OS", taken_at: 1 }, stale: false }) : new Response("ok", { status: 200 })) {
    const seen: Seen[] = []
    const env: Server_Env = {
        GOOGLE_ADMIN_EMAIL: "jason@jasouza.com", DB: db("jason@jasouza.com"), SERVER_AGENT_SECRET: "k".repeat(40),
        SERVER_HUB: { idFromName: () => "main", get: () => ({ fetch: async (request: Request) => { const path = new URL(request.url).pathname; seen.push({ path, role: request.headers.get("x-jazu-role"), body: await request.clone().text(), headers: request.headers }); return reply(path) } }) },
        ...extra,
    }
    return { env, seen }
}
const memory_cache = () => { const map = new Map<string, Response>(); const cache: Edge_Cache = { match: async request => map.get(request.url)?.clone(), put: async (request, response) => { map.set(request.url, response) } }; return { cache, map } }
const site = "https://jasouza.com"

test("without the binding every server route fails closed and unknown APIs keep their 501", async () => {
    assert.equal((await server_route(new Request(`${site}/api/_/server`), {})).status, 503)
    assert.equal((await gateway_route(new Request(`${site}/api/sample`), {}, "sample", "")).status, 501)
    const env: worker_env = { DOMAIN: "jasouza.com", PAGES_ORIGIN: "https://p.pages.dev" }
    assert.equal((await route(new Request(`${site}/api/sample`), env)).status, 501)
})

test("public status is cached for a minute and is never owner-flavoured; the owner's answer is private", async () => {
    const { env, seen } = hub_env()
    const { cache, map } = memory_cache()
    const first = await server_route(new Request(`${site}/api/_/server`), env, cache)
    assert.deepEqual(await first.json(), { online: true, snapshot: { text: "OS", taken_at: 1 }, stale: false, owner: false })
    assert.match(first.headers.get("cache-control")!, /max-age=60/)
    await server_route(new Request(`${site}/api/_/server`), env, cache)
    assert.equal(seen.filter(item => item.path === "/status").length, 1, "second visitor served from the edge")
    assert.equal(map.size, 1)
    const owner = await server_route(new Request(`${site}/api/_/server`, { headers: { cookie } }), env, cache)
    assert.equal((await owner.json() as any).owner, true)
    assert.equal(owner.headers.get("cache-control"), "no-store")
    assert.equal(seen.filter(item => item.path === "/status").length, 2)
    const stranger = hub_env({ DB: db("someone@else.com") })
    assert.equal((await (await server_route(new Request(`${site}/api/_/server`, { headers: { cookie } }), stranger.env, memory_cache().cache)).json() as any).owner, false)
})

test("the owner socket needs an upgrade, the site's own origin and an allowed e-mail", async () => {
    const { env, seen } = hub_env()
    const ws = (headers: Record<string, string>) => server_route(new Request(`${site}/api/_/server/ws`, { headers: { upgrade: "websocket", ...headers } }), env)
    assert.equal((await server_route(new Request(`${site}/api/_/server/ws`), env)).status, 426)
    assert.equal((await ws({ cookie, origin: "https://evil.example" })).status, 403)
    assert.equal((await ws({ origin: site })).status, 403)
    assert.equal((await ws({ cookie, origin: site })).status, 200)
    assert.equal(seen.at(-1)!.path, "/connect-owner"); assert.equal(seen.at(-1)!.role, "owner")
    const other = hub_env({ DB: db("someone@else.com") })
    assert.equal((await server_route(new Request(`${site}/api/_/server/ws`, { headers: { upgrade: "websocket", cookie, origin: site } }), other.env)).status, 403)
    const list = hub_env({ SERVER_OWNER_EMAILS: "a@x.com, Jason@JASOUZA.com" })
    assert.equal((await server_route(new Request(`${site}/api/_/server/ws`, { headers: { upgrade: "websocket", cookie, origin: site } }), list.env)).status, 200)
})

test("the agent socket needs the HMAC of the shared secret, once", async () => {
    const { env, seen } = hub_env()
    const url = `${site}/api/_/server/agent`
    const attempt = async (secret: string, headers?: Headers) => server_route(new Request(url, { headers: new Headers({ upgrade: "websocket", ...Object.fromEntries((headers ?? await sign_origin(new Request(url), secret, agent_client_id)).entries()) }) }), env)
    assert.equal((await attempt("x".repeat(40))).status, 401)
    const good = await sign_origin(new Request(url), env.SERVER_AGENT_SECRET!, agent_client_id)
    assert.equal((await attempt("", good)).status, 200)
    assert.equal(seen.at(-1)!.role, "agent")
    assert.equal((await attempt("", good)).status, 401, "replay")
    assert.equal((await server_route(new Request(url, { headers: { upgrade: "websocket" } }), env)).status, 401)
    assert.equal((await server_route(new Request(url, { headers: { upgrade: "websocket" } }), { ...env, SERVER_AGENT_SECRET: undefined })).status, 503)
})

test("gateway: names, reserved words and the shape of what reaches the script", async () => {
    assert.deepEqual(gateway_target("/api/sample/a/b"), { name: "sample", rest: "a/b" })
    assert.deepEqual(gateway_target("/api/sample"), { name: "sample", rest: "" })
    for (const bad of ["/api", "/api/", "/api/_/x", "/api/_/server/x", "/api/api", "/api/.x", "/api/a b"]) assert.equal(gateway_target(bad), null, bad)
    const { env, seen } = hub_env()
    const request = new Request(`${site}/api/sample/friend/7?x=1&x=2&y=3`, { method: "POST", headers: { cookie, authorization: "Bearer t", "content-type": "application/json", "x-evil": "1", "cf-connecting-ip": "5.5.5.5" }, body: '{"a":1}' })
    await gateway_route(request, env, "sample", "friend/7")
    const call = JSON.parse(seen.at(-1)!.body)
    assert.equal(seen.at(-1)!.path, "/call"); assert.equal(seen.at(-1)!.role, "gateway")
    assert.deepEqual([call.name, call.method, call.path, call.ip, call.owner], ["sample", "POST", "friend/7", "5.5.5.5", true])
    assert.deepEqual(call.query, { x: ["1", "2"], y: "3" })
    assert.deepEqual(call.headers, { authorization: "Bearer t", "content-type": "application/json" })
    assert.equal(atob(call.body), '{"a":1}')
    assert.equal((await gateway_route(new Request(`${site}/api/sample/a%2Fb`), env, "sample", "a%2Fb")).status, 400)
    assert.equal((await gateway_route(new Request(`${site}/api/sample/%E0%A4%A`), env, "sample", "%E0%A4%A")).status, 400)
    assert.equal((await gateway_route(new Request(`${site}/api/sample`, { method: "OPTIONS" }), env, "sample", "")).status, 405)
    const big = await gateway_route(new Request(`${site}/api/sample`, { method: "POST", body: new Uint8Array(700 * 1024), headers: { "content-length": String(700 * 1024) } }), env, "sample", "")
    assert.equal(big.status, 413)
})

test("gateway: a script's reply is filtered, sandboxed and never cached for the owner; the object's own errors pass through", async () => {
    const answer = { status: 201, headers: { "content-type": "text/html", "set-cookie": "a=b", "x-secret": "1", "cache-control": "public, max-age=5", location: "/x" }, body: btoa("<b>hi</b>") }
    const { env } = hub_env({}, () => Response.json(answer))
    const stranger = await gateway_route(new Request(`${site}/api/sample`), env, "sample", "")
    assert.equal(stranger.status, 201); assert.equal(await stranger.text(), "<b>hi</b>")
    assert.equal(stranger.headers.get("set-cookie"), null); assert.equal(stranger.headers.get("x-secret"), null)
    assert.equal(stranger.headers.get("content-security-policy"), "sandbox")
    assert.equal(stranger.headers.get("cache-control"), "public, max-age=5")
    const owner = await gateway_route(new Request(`${site}/api/sample`, { headers: { cookie } }), env, "sample", "")
    assert.equal(owner.headers.get("cache-control"), "no-store")
    const head = await gateway_route(new Request(`${site}/api/sample`, { method: "HEAD" }), env, "sample", "")
    assert.equal(await head.text(), "")
    const nothing = hub_env({}, () => Response.json({ status: 204, headers: {}, body: "" }))
    assert.equal((await gateway_route(new Request(`${site}/api/sample`), nothing.env, "sample", "")).status, 204)
    const missing = hub_env({}, () => Response.json({ error: { code: "not_found", message: "Not found" } }, { status: 404 }))
    const passed = await gateway_route(new Request(`${site}/api/sample`), missing.env, "sample", "")
    assert.equal(passed.status, 404)
    const worker = await route(new Request(`${site}/api/sample`), { DOMAIN: "jasouza.com", PAGES_ORIGIN: "https://p.pages.dev", ...hub_env({}, () => Response.json(answer)).env })
    assert.equal(worker.status, 201, "the Worker router hands /api/{name} to the gateway")
})
