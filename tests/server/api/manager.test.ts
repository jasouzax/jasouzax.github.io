/* Real child processes, SQLite, immutable releases and signed HTTP transport against temporary owner-controlled files. */
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { once } from "node:events"
import { setTimeout } from "node:timers/promises"
import { Api_Manager } from "../../../server/api/manager.ts"
import { personal_server } from "../../../server/repo/index.ts"
import { custom_api_route } from "../../../cloud/gateway.ts"
import { sign_origin } from "../../../shared/sign.ts"
import type { Api_Call } from "../../../shared/api/types.ts"
import { build } from "esbuild"
import { Miniflare, convertV4MiniflareOptions } from "miniflare"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
const entry = resolve("server/api/child.ts")
const call = (): Api_Call => ({ method: "GET", path: "/", query: {}, headers: {}, actor: { owner: false }, ip: "test", request_id: crypto.randomUUID() })
const source = (version = 1, label = "original") => `const api = new API({ id: 'sample', version: ${version}, access: 'public' }); api.get('/', () => { const value = api.store.get('count') || 0; api.store.set('count', value + 1); return { count: value + 1, label: '${label}', pid: process.pid } });`
test("versions run separately, releases rollback and SQLite survives crash and supervisor restart", { timeout: 40000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), "jazu-api-process-")), file = join(root, "sample.auto.js"), directory = join(root, "state")
    let manager = new Api_Manager(directory, entry)
    try {
        assert.throws(() => new Api_Manager(directory, entry), /Another API supervisor/)
        writeFileSync(file, source()); await manager.deploy(file)
        const first = await manager.call("sample", 1, call()); assert.equal(first.status, 200); assert.equal((first.body as any).data.count, 1)
        writeFileSync(file, source(2)); await manager.deploy(file)
        const second = await manager.call("sample", 2, call()); assert.equal((second.body as any).data.count, 2); assert.notEqual((first.body as any).data.pid, (second.body as any).data.pid)
        writeFileSync(file, source(1, "new")); await manager.deploy(file)
        assert.equal(((await manager.call("sample", 1, call())).body as any).data.label, "new")
        await manager.rollback("sample", 1)
        assert.equal(((await manager.call("sample", 1, call())).body as any).data.label, "original")
        writeFileSync(file, "throw new Error('broken deployment')")
        await assert.rejects(manager.deploy(file))
        assert.equal((await manager.call("sample", 1, call())).status, 200)
        const previous = manager.active.get("sample/v1")!; previous.child.kill()
        for (let attempt = 0; attempt < 80 && (!manager.active.get("sample/v1")?.manifest || manager.active.get("sample/v1") === previous); attempt++) await setTimeout(50)
        assert.notEqual(manager.active.get("sample/v1"), previous)
        assert.equal((await manager.call("sample", 1, call())).status, 200)
        await manager.close(); manager = new Api_Manager(directory, entry); await manager.restore()
        assert.equal(manager.manifests().length, 2)
        assert.equal((await manager.call("sample", 2, call())).status, 200)
        await manager.stop("sample", 1)
        assert.equal((await manager.call("sample", 1, call())).status, 404)
        assert(!readFileSync(join(directory, "audit.jsonl"), "utf8").includes("authorization"))
    } finally { await manager.close(); rmSync(root, { recursive: true, force: true }) }
})
test("Worker gateway and real Node listener use signed envelopes, strip cookies and isolate management", { timeout: 20000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), "jazu-api-http-")), file = join(root, "sample.auto.js"), manager = new Api_Manager(join(root, "state"), entry)
    const secret = "test-secret-".repeat(4)
    const server = personal_server({ secret, repositories: {}, port: 0, apis: manager })
    await once(server, "listening")
    const origin = `http://127.0.0.1:${(server.address() as any).port}`
    try {
        writeFileSync(file, source()); await manager.deploy(file)
        const env = { DOMAIN: "example.com", PAGES_ORIGIN: "https://pages.example.com", PERSONAL_ORIGIN: origin, ORIGIN_HMAC_SECRET: secret }
        const seen: Request[] = []
        const upstream = async (request: Request) => { seen.push(request.clone()); return fetch(request) }
        const request = new Request("https://example.com/api/sample/v1/", { headers: { cookie: "unrelated-private-cookie=value", authorization: "Bearer a-service-token" } })
        const response = await custom_api_route(request, env, upstream)
        assert.equal(response.status, 200); assert.equal((await response.json() as any).data.label, "original")
        assert.equal(response.headers.get("set-cookie"), null); assert.match(response.headers.get("content-security-policy")!, /sandbox/)
        assert(seen.every(request => !request.headers.has("cookie") && !request.headers.has("authorization")))
        const bundle = await build({ entryPoints: ["cloud/router/index.ts"], bundle: true, write: false, platform: "browser", format: "esm" })
        const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: "2026-11-04", bindings: env, outboundService: async edge_request => fetch(new Request(new URL(new URL(edge_request.url).pathname, origin), { method: edge_request.method, headers: Object.fromEntries(edge_request.headers.entries()), body: await edge_request.text() })) }))
        try {
            const edge = await runtime.dispatchFetch("https://example.com/api/sample/v1/")
            assert.equal(edge.status, 200); assert.equal((await edge.json() as any).data.label, "original")
            const retired = await runtime.dispatchFetch("https://example.com/api/sample")
            assert.equal(retired.status, 501)
        } finally { await runtime.dispose() }
        const command = await promisify(execFile)(process.execPath, [resolve("src/main.ts"), "server", "api", "status", "--root", root, "--port", String((server.address() as any).port)], { env: { ...process.env, ORIGIN_HMAC_SECRET: secret }, windowsHide: true })
        assert.equal(JSON.parse(command.stdout).length, 1)
        assert.equal((await fetch(origin + "/custom-api/_/status", { method: "POST", body: "{}" })).status, 401)
        const management = new Request(origin + "/custom-api/_/stop", { method: "POST", body: JSON.stringify({ id: "sample", version: 1 }) })
        const gateway_headers = await sign_origin(management, secret, "api-gateway")
        assert.equal((await fetch(management.url, { method: "POST", headers: gateway_headers, body: await management.clone().text() })).status, 404)
        const headers = await sign_origin(management, secret, "api-admin"), text = await management.text()
        assert.equal((await fetch(management.url, { method: "POST", headers, body: text })).status, 200)
        assert.equal((await fetch(management.url, { method: "POST", headers, body: text })).status, 401)
        assert.equal((await custom_api_route(new Request("https://example.com/api/sample/v1/"), env, upstream)).status, 404)
    } finally { await manager.close(); await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections() }); rmSync(root, { recursive: true, force: true }) }
})

test("the parent watchdog stops a CPU-bound handler and replay reports the interrupted request", { timeout: 15000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), "jazu-api-watchdog-")), source = join(root, "hang.auto.js"), manager = new Api_Manager(join(root, "state"), entry)
    try {
        writeFileSync(source, "const api=new API({id:'watchdog',version:1,access:'public'});const held=api.job('held',()=>new Promise(()=>{}));api.post('/job',()=>api.reply(held.run(null,{key:'held'}),202));api.get('/jobs/:id',ctx=>api.jobs.get(ctx.params.id));api.post('/',{idempotent:true},()=>{api.store.set('count',(api.store.get('count')||0)+1);while(true){}});api.get('/',()=>api.store.get('count'));")
        await manager.deploy(source)
        const queued = await manager.call("watchdog", 1, { ...call(), method: "POST", path: "/job" }), job = (queued.body as any).data
        const job_call = { ...call(), path: `/jobs/${job.id}` }
        for (let attempt = 0; attempt < 30 && ((await manager.call("watchdog", 1, job_call)).body as any).data.state !== "running"; attempt++) await setTimeout(10)
        const first = manager.active.get("watchdog/v1")!
        const request = { ...call(), method: "POST", body: {}, headers: { "idempotency-key": "interrupted" } }
        assert.equal((await first.call(request, 300)).status, 504)
        await first.stopped
        for (let attempt = 0; attempt < 100 && !manager.active.get("watchdog/v1")?.manifest; attempt++) await setTimeout(30)
        assert.equal((await manager.call("watchdog", 1, request)).status, 409)
        assert.equal(((await manager.call("watchdog", 1, call())).body as any).data, 1)
        assert.equal(((await manager.call("watchdog", 1, job_call)).body as any).data.state, "interrupted")
    } finally { await manager.close(); rmSync(root, { recursive: true, force: true }) }
})
