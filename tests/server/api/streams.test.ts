import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { createHash } from "node:crypto"
import { once } from "node:events"
import { Runtime_API } from "../../../server/api/runtime.ts"
import { Api_Manager } from "../../../server/api/manager.ts"
import { Api_Channel } from "../../../server/api/streams.ts"
import { personal_server } from "../../../server/repo/index.ts"
import { custom_api_route } from "../../../cloud/gateway.ts"
import type { Api_Call, Api_Config, Api_Result } from "../../../shared/api/types.ts"
import { build, transform } from "esbuild"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { Miniflare, convertV4MiniflareOptions } from "miniflare"

const request = (path = "/events", extra: Partial<Api_Call> = {}): Api_Call => ({ method: "GET", path, query: {}, headers: {}, actor: { owner: false }, ip: "local", request_id: crypto.randomUUID(), ...extra })
function fixture(config: Partial<Api_Config> = {}) {
    const root = mkdtempSync(join(tmpdir(), "jazu-stream-")), api = new Runtime_API({ id: "stream", version: 1, access: "public", ...config }, root)
    return { root, api, close() { api.close(); rmSync(root, { recursive: true, force: true }) } }
}
const data = (result: Api_Result): any => (result.body as any).data
const command = (open: Api_Result, action: "read" | "send" | "close", extra: Partial<Api_Call> = {}, value?: unknown): Api_Call => request("/events", { ...extra, stream: { id: open.stream!.id, action, cursor: open.stream!.cursor, ...(value === undefined ? {} : { data: value }) } })

test("channels replay independently with bounded snapshots, expired cursors and event injection rejection", () => {
    const channel = new Api_Channel("sensors"), initial = channel.cursor, value = { count: 1 }
    const first = channel.emit(value, "temperature"); value.count = 999
    const a = channel.read(initial); assert.equal((a[0].data as any).count, 1); (a[0].data as any).count = 3
    assert.equal((channel.read(initial)[0].data as any).count, 1)
    assert.equal(channel.read(first).length, 0)
    assert.throws(() => channel.emit("no", "event\ndata: injected"))
    assert.throws(() => channel.emit("x".repeat(16384)))
    for (let index = 0; index < 300; index++) channel.emit(index)
    assert.equal(channel.events.length, 256)
    assert.throws(() => channel.read(first), /history is unavailable/)
    assert.throws(() => channel.read(new Api_Channel("other").cursor), /history is unavailable/)
})

test("stream tickets are single use and scoped connections enforce live policy on every read/send", async () => {
    const token = "service-token", hash = createHash("sha256").update(token).digest("hex"), f = fixture({ access: "token", tokens: [{ hash, scopes: ["read"] }] })
    try {
        const channel = f.api.channel("updates")
        f.api.stream("/events", { scopes: ["read"] }, () => channel)
        const headers = { authorization: `Bearer ${token}` }
        assert.equal((await f.api.dispatch(request())).status, 404)
        const ticket = data(await f.api.dispatch(request("/events", { method: "POST", headers })))
        assert.equal(typeof ticket.ticket, "string")
        const opened = await f.api.dispatch(request("/events", { query: { ticket: ticket.ticket } }))
        assert(opened.stream); assert.equal(JSON.stringify(opened).includes(token), false)
        assert.equal((await f.api.dispatch(request("/events", { query: { ticket: ticket.ticket } }))).status, 403)
        channel.emit({ changed: true })
        assert.equal(data(await f.api.dispatch(command(opened, "read"))).events[0].data.changed, true)
        assert.equal((await f.api.dispatch(command(opened, "read", { path: "/other" }))).status, 404)
        assert.equal((await f.api.dispatch(command(opened, "send", {}, {}))).status, 405)
        f.api.config.tokens = []
        assert.equal((await f.api.dispatch(command(opened, "read"))).status, 404)
        f.api.config.tokens = [{ hash, scopes: [] }]
        assert.equal((await f.api.dispatch(command(opened, "read"))).status, 403)
    } finally { f.close() }
})

test("owner streams cannot survive loss or substitution of their signed session", async () => {
    const f = fixture({ access: "owner" })
    try {
        f.api.stream("/events", () => f.api.channel("private"))
        const actor = { owner: true, subject: "owner" }, opened = await f.api.dispatch(request("/events", { actor }))
        assert(opened.stream)
        assert.equal((await f.api.dispatch(command(opened, "read"))).status, 404)
        assert.equal((await f.api.dispatch(command(opened, "read", { actor: { owner: true, subject: "other" } }))).status, 404)
        assert.equal((await f.api.dispatch(command(opened, "read", { actor }))).status, 200)
        await f.api.dispatch(command(opened, "close", { actor }))
        assert.equal((await f.api.dispatch(command(opened, "read", { actor }))).status, 410)
    } finally { f.close() }
})

test("sockets deliver initial frames, JSON replies and ordered closure; stale and idle capabilities fail", async () => {
    const f = fixture({ timeout_ms: 30 }); let closed = 0
    try {
        f.api.socket("/events", (_, socket) => {
            socket.send({ ready: true }); socket.onclose = () => { closed++ }
            socket.onmessage = value => { socket.send({ echo: value }); socket.close() }
        })
        const opened = await f.api.dispatch(request())
        const initial = data(await f.api.dispatch(command(opened, "read")))
        assert.equal(initial.events[0].data.ready, true)
        assert.equal((await f.api.dispatch(command(opened, "send", {}, "hello"))).status, 200)
        const end = data(await f.api.dispatch({ ...command(opened, "read"), stream: { id: opened.stream!.id, action: "read", cursor: initial.cursor } }))
        assert.equal(end.events[0].data.echo, "hello"); assert.equal(end.closed, true)
        assert.equal((await f.api.dispatch(command(opened, "send", {}, "again"))).status, 405)
        await f.api.dispatch(command(opened, "close")); await f.api.dispatch(command(opened, "close")); assert.equal(closed, 1)
        const stale = await f.api.dispatch(request()); f.api.streams.connections.get(stale.stream!.id)!.idle = Date.now() - 1
        assert.equal((await f.api.dispatch(command(stale, "read"))).status, 410)
        f.api.socket("/many", (_, socket) => { for (let index = 0; index < 20; index++) socket.send(index); socket.close() })
        const many = await f.api.dispatch(request("/many"))
        const firstBatch = data(await f.api.dispatch(request("/many", { stream: { id: many.stream!.id, action: "read", cursor: many.stream!.cursor } })))
        assert.equal(firstBatch.events.length, 16); assert.equal(firstBatch.closed, false)
        const finalBatch = data(await f.api.dispatch(request("/many", { stream: { id: many.stream!.id, action: "read", cursor: firstBatch.cursor } })))
        assert.equal(finalBatch.events.length, 4); assert.equal(finalBatch.closed, true)
    } finally { f.close() }
})

test("pub/sub fanout and generated schema/client artifacts preserve policy without credentials", async () => {
    const f = fixture({ tokens: [{ hash: "a".repeat(64), scopes: ["write"] }] })
    try {
        const seen: unknown[] = [], unsubscribe = f.api.pubsub.subscribe("sensor/temp", value => seen.push(value))
        f.api.pubsub.publish("sensor/temp", { c: 30 }); unsubscribe(); f.api.pubsub.publish("sensor/temp", { c: 31 })
        assert.deepEqual(seen, [{ c: 30 }]); assert.equal(f.api.pubsub.channel("sensor/temp").events.length, 2)
        f.api.post("/sensor/:id", { scopes: ["write"], body: { type: "object", properties: { c: { type: "number" } }, required: ["c"], additionalProperties: false }, response: { type: "boolean" } }, () => true)
        f.api.query("/search", () => [])
        f.api.get("/literal:colon", () => true)
        f.api.stream("/logs", { scopes: ["logs"] }, () => f.api.logs)
        const spec = f.api.openapi() as any, client = f.api.client()
        assert.equal(spec.paths["/sensor/{id}"].post.requestBody.content["application/json"].schema.required[0], "c")
        assert.deepEqual(spec.paths["/sensor/{id}"].post["x-jazu-scopes"], ["write"])
        assert(spec.paths["/search"]["x-jazu-query"])
        assert(spec.paths["/literal:colon"].get)
        assert.equal(spec.paths["/logs"].get["x-jazu-transport"], "sse")
        assert(!JSON.stringify(spec).includes("a".repeat(64))); assert(!client.includes("a".repeat(64)))
        assert.match(client, /"c": number/); assert.match(client, /response: boolean/)
        const compiled = await transform(client, { loader: "ts", format: "esm" }); assert(compiled.code.includes("class ApiClient"))
        const generated = join(f.root, "client.ts")
        writeFileSync(generated, client)
        await promisify(execFile)(process.execPath, [resolve("node_modules/typescript/bin/tsc"), "--ignoreConfig", "--noEmit", "--strict", "--skipLibCheck", "--target", "ES2022", "--module", "esnext", generated], { windowsHide: true })
        f.api.log("warn", "sensor unavailable"); assert.equal(f.api.logs.events[0].event, "log")
    } finally { f.close() }
})

test("real child/HTTP/Worker SSE streams, tickets, resume and cancellation release capabilities", { timeout: 20000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), "jazu-sse-")), manager = new Api_Manager(join(root, "state"), resolve("server/api/child.ts")), file = join(root, "stream.auto.js")
    const secret = "s".repeat(40), server = personal_server({ secret, repositories: {}, port: 0, apis: manager })
    await once(server, "listening")
    const origin = `http://127.0.0.1:${(server.address() as any).port}`, env = { DOMAIN: "example.com", PAGES_ORIGIN: "https://pages.example.com", PERSONAL_ORIGIN: origin, ORIGIN_HMAC_SECRET: secret }
    try {
        writeFileSync(file, `const api=new API({id:'stream',version:1,access:'public',deprecated:'2027-01-01'});const c=api.channel('updates');api.stream('/events',()=>c);api.post('/emit',ctx=>c.emit(ctx.body));api.get('/count',()=>api.streams.connections.size);api.socket('/socket',(_,socket)=>{socket.send({ready:true});socket.onmessage=value=>socket.send({echo:value})});`)
        await manager.deploy(file)
        const ticketResponse = await custom_api_route(new Request("https://example.com/api/stream/v1/events", { method: "POST" }), env)
        const ticket = (await ticketResponse.json() as any).data.ticket
        const response = await custom_api_route(new Request(`https://example.com/api/stream/v1/events?ticket=${ticket}`), env)
        assert.equal(response.headers.get("content-type"), "text/event-stream; charset=utf-8")
        assert.equal(response.headers.get("sunset"), new Date("2027-01-01").toUTCString())
        const reader = response.body!.getReader(), decoder = new TextDecoder()
        const nextEvent = async () => { for (let index = 0; index < 10; index++) { const value = decoder.decode((await reader.read()).value); if (value.includes("data:")) return value }; throw new Error("No SSE event") }
        await manager.call("stream", 1, request("/emit", { method: "POST", body: { live: true } }))
        const first = await nextEvent(); assert.match(first, /data: {"live":true}/)
        const cursor = /^id: (.+)$/m.exec(first)![1]
        await reader.cancel()
        assert.equal(data(await manager.call("stream", 1, request("/count"))), 0)
        await manager.call("stream", 1, request("/emit", { method: "POST", body: { resumed: true } }))
        const resumed = await custom_api_route(new Request("https://example.com/api/stream/v1/events", { headers: { "last-event-id": cursor } }), env)
        const resumedReader = resumed.body!.getReader()
        assert.match(decoder.decode((await resumedReader.read()).value), /"resumed":true/); await resumedReader.cancel()
        assert.equal((await custom_api_route(new Request("https://example.com/api/stream/v1/events", { method: "HEAD" }), env)).status, 405)
        assert.equal((await custom_api_route(new Request("https://example.com/api/stream/v1/socket", { headers: { upgrade: "websocket", origin: "https://evil.example" } }), env)).status, 403)
        const bundle = await build({ entryPoints: ["cloud/router/index.ts"], bundle: true, write: false, platform: "browser", format: "esm" })
        const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: "2026-11-04", bindings: env, outboundService: async edge => fetch(new Request(new URL(new URL(edge.url).pathname, origin), { method: edge.method, headers: Object.fromEntries(edge.headers.entries()), body: await edge.text() })) }))
        try {
            const ticketResponse = await runtime.dispatchFetch("https://example.com/api/stream/v1/socket", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
            const ticketBody = await ticketResponse.json() as any
            assert.equal(ticketResponse.status, 200, JSON.stringify(ticketBody))
            const ticket = ticketBody.data.ticket
            const upgrade = await runtime.dispatchFetch(`https://example.com/api/stream/v1/socket?ticket=${ticket}`, { headers: { upgrade: "websocket", origin: "https://example.com" } })
            assert.equal(upgrade.status, 101)
            const socket = upgrade.webSocket!; const messages: any[] = []
            let received!: () => void
            const done = new Promise<void>(resolve => { received = resolve })
            socket.addEventListener("message", event => { const value = JSON.parse(String(event.data)); messages.push(value); if (value.data?.ready) socket.send(JSON.stringify("hello")); if (value.data?.echo === "hello") received() })
            socket.accept(); await done
            assert(messages.some(value => value.data.echo === "hello")); socket.close(1000)
            for (let attempt = 0; attempt < 100 && data(await manager.call("stream", 1, request("/count"))) !== 0; attempt++) await new Promise(resolve => setTimeout(resolve, 10))
            assert.equal(data(await manager.call("stream", 1, request("/count"))), 0)
        } finally { await runtime.dispose() }
    } finally { await manager.close(); await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections() }); rmSync(root, { recursive: true, force: true }) }
})
