/* Public provider-first reads, bounded retries and real Smart HTTP clone/fetch through the Pi fallback. */
import { test } from "node:test"
import assert from "node:assert/strict"
import { execFile, execFileSync } from "node:child_process"
import { once } from "node:events"
import { createServer } from "node:http"
import { Readable } from "node:stream"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { route } from "../src/node/worker.ts"
import type { worker_env } from "../src/node/worker.ts"
import { sign_origin, verify_origin } from "../src/node/security.ts"
import { clone_origins, project_declarations } from "../src/pipeline_types.ts"
import { parse_xml } from "../src/xml.ts"
import { personal_server } from "../src/node/personal.ts"
import { load_server_config } from "../src/node/server_config.ts"

const secret = "test-origin-secret-with-more-than-32-characters"
const env: worker_env = { DOMAIN: "example.com", PAGES_ORIGIN: "https://pages.example.dev", PUBLIC_PROJECTS: '["demo"]', PROJECT_CLONE_ORIGINS: '{"demo":"https://github.com/team/demo.git"}', PERSONAL_ORIGIN: "https://node.example.net", ORIGIN_HMAC_SECRET: secret, ACCESS_CLIENT_ID: "access-test", ACCESS_CLIENT_SECRET: "access-secret-test" }
const discovery = "https://example.com/projects/demo/info/refs?service=git-upload-pack"
const git_response = (operation: string, body = "git protocol") => new Response(body, { headers: { "content-type": `application/x-git-upload-pack-${operation}` } })

test("clone origins come from public project repo declarations, including GitHub SSH aliases", () => {
    const xml = '<project id="one" repo="github.com/team/one"/><project id="two" repo="git@github.com:team/two.git"/><project id="private" private="true" repo="github.com/team/private"/><project id="other" repo="git@git.example:team/other"/><project id="local"><pipeline/></project>'
    assert.deepEqual({ ...clone_origins(project_declarations(parse_xml(xml, "projects.xml"))) }, { one: "https://github.com/team/one.git", two: "https://github.com/team/two.git" })
})

test("public discovery uses the configured provider without forwarding visitor or origin credentials", async () => {
    const response = await route(new Request(discovery, { headers: { authorization: "Basic personal-token", cookie: "visitor", "x-jazu-signature": "private", "CF-Access-Client-Secret": "private", "git-protocol": "version=2" } }), env, async request => {
        assert.equal(request.url, "https://github.com/team/demo.git/info/refs?service=git-upload-pack")
        assert.equal(request.headers.get("git-protocol"), "version=2")
        for (const key of ["authorization", "cookie", "x-jazu-signature", "CF-Access-Client-Secret"]) assert.equal(request.headers.get(key), null)
        return git_response("advertisement")
    })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get("cache-control"), "no-store")
})

test("missing or failed providers redirect discovery onto the website's pinned Pi endpoint", async () => {
    for (const failure of [401, 404, 429, 503, "html", "network", "missing"] as const) {
        const response = await route(new Request(discovery), { ...env, PROJECT_CLONE_ORIGINS: failure === "missing" ? "{}" : env.PROJECT_CLONE_ORIGINS }, async () => {
            if (failure === "network") throw new Error("offline")
            if (failure === "missing") assert.fail("missing repo must not make an external request")
            return new Response("unavailable", { status: typeof failure === "number" ? failure : 200 })
        })
        assert.equal(response.status, 307, String(failure))
        assert.equal(response.headers.get("location"), "https://example.com/projects/demo/_git/pi/info/refs?service=git-upload-pack")
    }
    await route(new Request("https://example.com/projects/demo/_git/pi/git-upload-pack", { method: "POST", body: "wants", headers: { authorization: "Basic personal-token" } }), env, async request => {
        assert.equal(new URL(request.url).hostname, "node.example.net")
        assert.equal(await verify_origin(request, secret, new Map(), Date.now(), true), true)
        assert.equal(request.headers.get("authorization"), "Basic personal-token")
        assert.equal(await request.text(), "wants")
        return git_response("result")
    })
})

test("a failed provider POST replays the exact bounded negotiation body to the signed Pi backend", async () => {
    const seen: string[] = []
    const response = await route(new Request("https://example.com/projects/demo.git/git-upload-pack", { method: "POST", body: "want 123\n0000", headers: { "content-type": "application/x-git-upload-pack-request" } }), env, async request => {
        seen.push(await request.text())
        if (new URL(request.url).hostname === "github.com") return new Response("down", { status: 503 })
        assert.equal(await verify_origin(request, secret, new Map(), Date.now(), true), true)
        return git_response("result")
    })
    assert.equal(response.status, 200)
    assert.deepEqual(seen, ["want 123\n0000", "want 123\n0000"])
    assert.equal((await route(new Request("https://example.com/projects/demo/git-upload-pack", { method: "POST", body: "x", headers: { "content-length": String(8 * 1024 * 1024 + 1) } }), env, async () => assert.fail())).status, 413)
})

test("provider rename redirects stay on its HTTPS origin; private reads and pushes always use the Pi", async () => {
    let calls = 0
    const renamed = await route(new Request(discovery), env, async request => {
        calls++
        if (calls === 1) return new Response(null, { status: 301, headers: { location: "https://github.com/team/renamed.git/info/refs?service=git-upload-pack" } })
        assert(request.url.includes("renamed.git"))
        return git_response("advertisement")
    })
    assert.equal(renamed.status, 200)
    const unsafe = await route(new Request(discovery), env, async () => new Response(null, { status: 302, headers: { location: "https://other.example/repo.git/info/refs" } }))
    assert.equal(unsafe.status, 307)
    for (const url of ["https://example.com/projects/demo/info/refs?service=git-receive-pack", "https://example.com/projects/demo/_git/pi/info/refs?service=git-receive-pack", "https://example.com/projects/private/info/refs?service=git-upload-pack"]) {
        await route(new Request(url), env, async request => { assert.equal(new URL(request.url).hostname, "node.example.net"); return new Response("ok") })
    }
})

function git(dir: string, ...args: string[]): string {
    return execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()
}

test("real Git clone and fetch work through the provider and a pinned Pi fallback, with staging refs", { timeout: 120000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), "jazu_read_proxy_"))
    const work = join(root, "work")
    mkdirSync(work)
    git(work, "init", "-qb", "master")
    writeFileSync(join(work, "hello.txt"), "hello\n")
    git(work, "add", ".")
    git(work, "commit", "-qm", "initial")
    git(work, "branch", "staging")
    const bare = join(root, "repos/demo.git")
    mkdirSync(join(root, "repos"))
    git(root, "clone", "--bare", "-q", work, bare)
    git(bare, "update-ref", "refs/jazu-sync/upstream", "master")
    const file = join(root, "server.json")
    writeFileSync(file, JSON.stringify({ repos_dir: "repos", state_dir: "state", site: { project: "demo", dir: "work" }, projects: { demo: { active: true } } }))
    const node = personal_server({ secret, repositories: {}, port: 0, config: load_server_config(file) })
    await once(node, "listening")
    const node_origin = `http://127.0.0.1:${(node.address() as { port: number }).port}`
    let offline = false
    let provider_attempts = 0
    const edge_env = { ...env, PERSONAL_ORIGIN: node_origin }
    const upstream = async (request: Request): Promise<Response> => {
        if (new URL(request.url).hostname === "github.com") {
            provider_attempts++
            if (offline) { offline = false; return new Response("provider outage", { status: 503 }) }
            const operation = new URL(request.url).pathname.endsWith("info/refs") ? "info/refs" : "git-upload-pack"
            const target = new URL(`/git-http/demo.git/${operation}${new URL(request.url).search}`, node_origin)
            const headers = await sign_origin(new Request(target, { method: request.method }), secret, "test", Date.now(), "stream")
            for (const key of ["content-type", "git-protocol"]) if (request.headers.has(key)) headers.set(key, request.headers.get(key)!)
            return fetch(new Request(target, { method: request.method, headers, body: request.method === "POST" ? await request.arrayBuffer() : undefined }))
        }
        return fetch(request)
    }
    const edge = createServer(async (incoming, outgoing) => {
        try {
            const request = new Request(`http://${incoming.headers.host}${incoming.url}`, { method: incoming.method, headers: incoming.headers as Record<string, string>, body: incoming.method === "POST" ? Readable.toWeb(incoming) as ReadableStream : undefined, duplex: "half" } as RequestInit)
            const response = await route(request, edge_env, upstream)
            outgoing.writeHead(response.status, Object.fromEntries(response.headers))
            outgoing.end(Buffer.from(await response.arrayBuffer()))
        } catch (error) { outgoing.writeHead(500); outgoing.end(String(error)) }
    }).listen(0, "127.0.0.1")
    await once(edge, "listening")
    const url = `http://127.0.0.1:${(edge.address() as { port: number }).port}/projects/demo`
    const client = (...args: string[]) => new Promise<string>((resolve, reject) => execFile("git", args, { cwd: root, encoding: "utf8", timeout: 60000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }, (error, stdout, stderr) => error ? reject(new Error(stderr)) : resolve(stdout)))
    try {
        await client("clone", "--filter=blob:none", url, "provider")
        assert.equal(readFileSync(join(root, "provider/hello.txt"), "utf8").trim(), "hello")
        assert(provider_attempts > 0)
        await client("-C", "provider", "fetch", "origin")
        assert(git(join(root, "provider"), "branch", "-r").includes("origin/staging"))
        offline = true
        provider_attempts = 0
        await client("clone", "--depth", "1", url, "fallback")
        assert.equal(provider_attempts, 1, "Pi redirect must pin the backend even after the provider recovers")
        assert.equal(readFileSync(join(root, "fallback/hello.txt"), "utf8").trim(), "hello")
        edge_env.PROJECT_CLONE_ORIGINS = "{}"
        const refs = await client("ls-remote", url)
        assert(refs.includes("refs/heads/staging"))
        assert(!refs.includes("refs/jazu-sync"))
        assert.equal(provider_attempts, 1)
    } finally {
        edge.closeAllConnections(); node.closeAllConnections()
        await Promise.all([new Promise<void>(resolve => edge.close(() => resolve())), new Promise<void>(resolve => node.close(() => resolve()))])
        rmSync(root, { recursive: true, force: true })
    }
})
