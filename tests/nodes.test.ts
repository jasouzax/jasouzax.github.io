import { test } from "node:test"
import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { execFileSync } from "node:child_process"
import worker, { route, type worker_env } from "../src/node/worker.ts"
import { sign_origin, verify_origin } from "../src/node/security.ts"
import { git_read } from "../src/node/personal.ts"
import { prepare_deploy } from "../src/node/deploy.ts"
import type { build_result } from "../src/build.ts"

const env: worker_env = { DOMAIN: "example.com", PAGES_ORIGIN: "https://example.pages.dev", PUBLIC_PROJECTS: '["calculator"]' }

test("Worker routes only published project subdomains and rejects unknown hosts/APIs", async () => {
    const redirect = await route(new Request("https://calculator.example.com/test"), env)
    assert.equal(redirect.status, 301)
    assert.equal(redirect.headers.get("location"), "https://example.com/projects/calculator")
    assert.equal((await route(new Request("https://private.example.com"), env)).status, 404)
    assert.equal((await route(new Request("https://evil.com"), env)).status, 404)
    const api = await route(new Request("https://example.com/api/v1/messages", { method: "POST", body: "private" }), env)
    assert.equal(api.status, 501)
    assert.equal(api.headers.get("cache-control"), "no-store")
    assert.equal((await route(new Request("https://example.com/api/v1/git/calculator/refs"), env)).status, 503)
})

test("Worker strips private request data from Pages and applies work security headers", async () => {
    let forwarded: Request | undefined
    const request = new Request("https://example.com/work?uuid=secret", { headers: { cookie: "__Host-session=secret", authorization: "Bearer private" } })
    const response = await route(request, env, async request => { forwarded = request; return new Response("shell") })
    assert.equal(response.status, 200)
    assert.equal(forwarded?.url, "https://example.pages.dev/work")
    assert.equal(forwarded?.headers.get("cookie"), null)
    assert.equal(forwarded?.headers.get("authorization"), null)
    const secured = await worker.fetch(new Request("https://example.com/api/v1/health"), env)
    assert.equal(secured.headers.get("x-content-type-options"), "nosniff")
})

test("Worker serves hashed R2 media ranges and WASM with appropriate metadata", async () => {
    let key = ""
    const response = await route(new Request("https://example.com/assets/media/abc.mp4", { headers: { range: "bytes=0-2" } }), {
        ...env, ASSETS: { async get(name) { key = name; return {
            body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); controller.close() } }),
            httpEtag: '"abc"', size: 10, range: { offset: 0, length: 3 },
            writeHttpMetadata(headers) { headers.set("content-type", "video/mp4") },
        } } },
    })
    assert.equal(key, "assets/media/abc.mp4")
    assert.equal(response.status, 206)
    assert.equal(response.headers.get("content-range"), "bytes 0-2/10")
    assert.equal(response.headers.get("content-type"), "video/mp4")
    assert.equal((await response.arrayBuffer()).byteLength, 3)
})

test("HMAC binds method/path/query/body/client/time and refuses replay", async () => {
    const secret = "a".repeat(64)
    const now = Date.now()
    const request = new Request("https://origin.example.com/git/calculator/tree?ref=HEAD")
    const headers = await sign_origin(request, secret, "public", now)
    const seen = new Map<string, number>()
    assert.equal(await verify_origin(new Request(request, { headers }), secret, seen, now), true)
    assert.equal(await verify_origin(new Request(request, { headers }), secret, seen, now), false)
    assert.equal(await verify_origin(new Request("https://origin.example.com/git/private/tree?ref=HEAD", { headers }), secret, new Map(), now), false)
    assert.equal(await verify_origin(new Request(request, { headers }), secret, new Map(), now + 61_000), false)
})

test("D1 migration enforces message idempotency and pin tenant references", () => {
    const db = new DatabaseSync(":memory:")
    try {
        db.exec(readFileSync(resolve("migrations/0001_work.sql"), "utf8"))
        const client = db.prepare("INSERT INTO clients(id,name,created_at) VALUES(?,?,?)")
        client.run("a", "A", 1); client.run("b", "B", 1)
        const message = db.prepare("INSERT INTO messages(id,client_id,idempotency_id,author,kind,created_at) VALUES(?,?,?,?,?,?)")
        message.run("m1", "a", "send1", "a", "text", 1)
        assert.throws(() => message.run("m2", "a", "send1", "a", "text", 2))
        assert.throws(() => db.prepare("INSERT INTO pins VALUES(?,?,?,?,?)").run("pin", "b", "m1", "{}", 0))
        assert.throws(() => db.prepare("INSERT INTO desk_state VALUES(?,?,?,?,?)").run("a", "owner", "invalid json", 1, 1))
    } finally { db.close() }
})

test("personal Git adapter reads only safe public repository resources", async () => {
    const root = mkdtempSync(join(tmpdir(), "jazu_git_"))
    try {
        execFileSync("git", ["init", root], { windowsHide: true, stdio: "ignore" })
        writeFileSync(join(root, "readme.txt"), "Public repository")
        execFileSync("git", ["-C", root, "add", "."], { windowsHide: true })
        execFileSync("git", ["-C", root, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "test: initial"], { windowsHide: true, stdio: "ignore" })
        const response = git_read(root, "blob", new URL("https://origin/git/project/blob?path=readme.txt"))
        assert.equal(await response.text(), "Public repository")
        assert.equal(git_read(root, "blob", new URL("https://origin/git/project/blob?path=../secret")).status, 400)
        assert.equal(git_read(root, "log", new URL("https://origin/git/project/log?ref=--all")).status, 400)
    } finally { rmSync(root, { recursive: true, force: true }) }
})

test("deployment staging separates oversized R2 assets from the Pages upload", () => {
    const root = mkdtempSync(join(tmpdir(), "jazu_deploy_"))
    try {
        mkdirSync(join(root, "dist/assets/media"), { recursive: true })
        writeFileSync(join(root, "dist/assets/media/large.mp4"), "12345678901")
        writeFileSync(join(root, "dist/index.html"), "home")
        writeFileSync(join(root, "dist/stray_secret.txt"), "do not deploy")
        writeFileSync(join(root, "dist/.jazu_output.json"), JSON.stringify(["index.html", "assets/media/large.mp4"]))
        writeFileSync(join(root, "wrangler.jsonc"), readFileSync(resolve("wrangler.jsonc")))
        const result = { model: { config: { base_url: "https://example.com", deploy: { worker_name: "router", pages_project: "pages" } }, objects: [] } } as unknown as build_result
        const stage = prepare_deploy(root, join(root, "dist"), result, 10)
        const pages = JSON.parse(readFileSync(stage.pages_config, "utf8")).pages_build_output_dir
        assert(existsSync(join(pages, "index.html")))
        assert(!existsSync(join(pages, "assets/media/large.mp4")))
        assert(!existsSync(join(pages, "stray_secret.txt")))
        assert.equal(stage.uploads[0].key, "assets/media/large.mp4")
        assert.equal(stage.uploads[0].content_type, "video/mp4")
    } finally { rmSync(root, { recursive: true, force: true }) }
})
