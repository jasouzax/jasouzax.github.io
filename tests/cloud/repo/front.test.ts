/* Tunnel-first reads, pinned fallback and real Smart HTTP clone/fetch. */
import { test } from "node:test"
import assert from "node:assert/strict"
import { execFile, execFileSync } from "node:child_process"
import { once } from "node:events"
import { createServer } from "node:http"
import { Readable } from "node:stream"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { repository_route } from "../../../cloud/repo/front.ts"
import { route } from "../../../cloud/router/index.ts"
import type { worker_env } from "../../../cloud/router/index.ts"
import { sign_origin, verify_origin } from "../../../cloud/security/headers.ts"
import { clone_origins, project_declarations } from "../../../shared/content/pipeline.ts"
import { parse_xml } from "../../../shared/content/xml.ts"
import { personal_server } from "../../../server/repo/index.ts"
import { load_server_config } from "../../../server/config/repositories.ts"

const secret = "test-origin-secret-with-more-than-32-characters"
const env: worker_env = { DOMAIN: "example.com", PAGES_ORIGIN: "https://pages.example.dev", PUBLIC_PROJECTS: '["demo"]', PROJECT_CLONE_ORIGINS: '{"demo":"https://github.com/team/demo.git"}', PERSONAL_ORIGIN: "https://node.example.net", ORIGIN_HMAC_SECRET: secret, ACCESS_CLIENT_ID: "access-test", ACCESS_CLIENT_SECRET: "access-secret-test" }
const discovery = "https://repo.example.com/demo/info/refs?service=git-upload-pack"
const git_response = (operation: string, body = "git protocol") => new Response(body, { headers: { "content-type": `application/x-git-upload-pack-${operation}` } })

test("clone origins come from public project repo declarations, including GitHub SSH aliases", () => {
    const xml = '<project id="one" repo="github.com/team/one"/><project id="two" repo="git@github.com:team/two.git"/><project id="private" private="true" repo="github.com/team/private"/><project id="other" repo="git@git.example:team/other"/><project id="local"><pipeline/></project>'
    assert.deepEqual({ ...clone_origins(project_declarations(parse_xml(xml, "projects.xml"))) }, { one: "https://github.com/team/one.git", two: "https://github.com/team/two.git" })
})

test("origin discovery is signed, then pins the personal backend", async () => {
    const response = await route(new Request(discovery, { headers: { authorization: "Basic token", cookie: "visitor" } }), env, async request => {
        assert.equal(new URL(request.url).hostname, "node.example.net")
        assert.equal(await verify_origin(request, secret, new Map(), Date.now(), true), true)
        assert.equal(request.headers.get("authorization"), "Basic token")
        assert.equal(request.headers.get("cookie"), null)
        return git_response("advertisement")
    })
    assert.equal(response.status, 307)
    assert.equal(response.headers.get("location"), "https://repo.example.com/demo/_git/origin/info/refs?service=git-upload-pack")
})

test("only origin timeout or 5xx permits public source fallback", async () => {
    for (const status of [401, 403, 404, 429, 500, 503]) {
        const response = await route(new Request(discovery), env, async () => new Response("origin", { status }))
        assert.equal(response.status, status >= 500 ? 307 : status)
        if (status >= 500) assert(response.headers.get("location")?.includes("/_git/source/"))
    }
    const response = await route(new Request(discovery), env, async () => { throw Error("offline") })
    assert.equal(response.status, 307)
})

test("source pin strips credentials and never switches to the origin", async () => {
    const url = "https://repo.example.com/demo/_git/source/info/refs?service=git-upload-pack"
    const response = await route(new Request(url, { headers: { authorization: "Basic token", cookie: "visitor", "git-protocol": "version=2" } }), env, async request => {
        assert.equal(new URL(request.url).hostname, "github.com")
        for (const key of ["authorization", "cookie", "CF-Access-Client-Secret"]) assert.equal(request.headers.get(key), null)
        assert.equal(request.headers.get("git-protocol"), "version=2")
        return git_response("advertisement")
    })
    assert.equal(response.status, 200)
    const failed = await route(new Request(url), env, async () => new Response("offline", { status: 503 }))
    assert.equal(failed.status, 503)
})

test("private reads and pushes never use source fallbacks; source negotiations are bounded", async () => {
    for (const path of ["private/info/refs?service=git-upload-pack", "demo/info/refs?service=git-receive-pack", "demo/_git/source/info/refs?service=git-receive-pack"]) {
        const response = await route(new Request("https://repo.example.com/" + path), env, async request => {
            assert.equal(new URL(request.url).hostname, "node.example.net")
            return new Response("down", { status: 503 })
        })
        assert.equal(response.status, 503)
    }
    const response = await route(new Request("https://repo.example.com/demo/_git/source/git-upload-pack", { method: "POST", body: "x", headers: { "content-length": String(8 * 1024 * 1024 + 1) } }), env, async () => assert.fail())
    assert.equal(response.status, 413)
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
            const operation = new URL(request.url).pathname.endsWith("info/refs") ? "info/refs" : "git-upload-pack"
            const target = new URL(`/git-http/demo.git/${operation}${new URL(request.url).search}`, node_origin)
            const headers = await sign_origin(new Request(target, { method: request.method }), secret, "test", Date.now(), "stream")
            for (const key of ["content-type", "git-protocol"]) if (request.headers.has(key)) headers.set(key, request.headers.get(key)!)
            return fetch(new Request(target, { method: request.method, headers, body: request.method === "POST" ? await request.arrayBuffer() : undefined }))
        }
        if (offline) return new Response("origin outage", { status: 503 })
        return fetch(request)
    }
    const edge = createServer(async (incoming, outgoing) => {
        try {
            const request = new Request(`http://${incoming.headers.host}${incoming.url}`, { method: incoming.method, headers: incoming.headers as Record<string, string>, body: incoming.method === "POST" ? Readable.toWeb(incoming) as ReadableStream : undefined, duplex: "half" } as RequestInit)
            const response = await repository_route(request, edge_env, ["demo"], upstream)
            outgoing.writeHead(response.status, Object.fromEntries(response.headers))
            outgoing.end(Buffer.from(await response.arrayBuffer()))
        } catch (error) { outgoing.writeHead(500); outgoing.end(String(error)) }
    }).listen(0, "127.0.0.1")
    await once(edge, "listening")
    const url = `http://127.0.0.1:${(edge.address() as { port: number }).port}/demo`
    const client = (...args: string[]) => new Promise<string>((resolve, reject) => execFile("git", args, { cwd: root, encoding: "utf8", timeout: 60000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }, (error, stdout, stderr) => error ? reject(new Error(stderr)) : resolve(stdout)))
    try {
        await client("clone", "--filter=blob:none", url, "provider")
        assert.equal(readFileSync(join(root, "provider/hello.txt"), "utf8").trim(), "hello")
        assert.equal(provider_attempts, 0)
        await client("-C", "provider", "fetch", "origin")
        assert(git(join(root, "provider"), "branch", "-r").includes("origin/staging"))
        offline = true
        provider_attempts = 0
        await client("clone", "--depth", "1", url, "fallback")
        assert(provider_attempts > 0, "source discovery and pack transfer stay on the source")
        assert.equal(readFileSync(join(root, "fallback/hello.txt"), "utf8").trim(), "hello")
        offline = false
        edge_env.PROJECT_CLONE_ORIGINS = "{}"
        provider_attempts = 0
        const refs = await client("ls-remote", url)
        assert(refs.includes("refs/heads/staging"))
        assert(!refs.includes("refs/jazu-sync"))
        assert.equal(provider_attempts, 0)
    } finally {
        edge.closeAllConnections(); node.closeAllConnections()
        await Promise.all([new Promise<void>(resolve => edge.close(() => resolve())), new Promise<void>(resolve => node.close(() => resolve()))])
        rmSync(root, { recursive: true, force: true })
    }
})
