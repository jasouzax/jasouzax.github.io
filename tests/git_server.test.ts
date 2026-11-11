/*
 * Personal server: git transport, hooks, static mirror, CI/CD pipeline and publish staging.
 * Everything runs against real `git` in temp folders; nothing touches Cloudflare. Needs git >= 2.31 on PATH.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { execFile, execFileSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import type { Server } from "node:http"
import { once } from "node:events"
import { Readable } from "node:stream"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import worker, { route } from "../src/node/worker.ts"
import { sign_origin, verify_origin } from "../src/node/security.ts"
import { hash_token, load_server_config, make_token, update_server_file, verify_token } from "../src/node/server_config.ts"
import type { Server_Config } from "../src/node/server_config.ts"
import { check_push, jobs_for_push, parse_updates, sync_repository } from "../src/node/git_hooks.ts"
import { enqueue, pending, claim, recover, finish } from "../src/node/queue.ts"
import { personal_server } from "../src/node/personal.ts"
import { refresh_mirror } from "../src/node/git_mirror.ts"
import { run_pipeline } from "../src/node/ci_jazu.ts"
import type { Pipeline_Steps, Run_Record } from "../src/node/ci_jazu.ts"
import { plan_batch, list_runs } from "../src/node/runner.ts"
import { fingerprint_pages, publish_pages, stage_pages } from "../src/node/publish.ts"

const secret = "s".repeat(64)
const identity = ["-c", "user.name=Test", "-c", "user.email=t@example.com"]

function git(cwd: string, ...args: string[]): string {
    return execFileSync("git", [...identity, "-C", cwd, ...args], { encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1", HOME: cwd }, stdio: ["ignore", "pipe", "pipe"] }).trim()
}

type Fixture = { dir: string, config: Server_Config, tokens: Record<string, string>, cleanup(): void }

// Hooks are installed after seeding: the archived repositories would (correctly) refuse the seeding push.
function install_hooks(config: Server_Config): void { for (const id of ["jazu", "oldproj", "secretproj"]) sync_repository(config, id) }

// A server.json with owner/writer/reader users and a bare `jazu` repository holding one commit on master.
function fixture(): Fixture {
    const dir = mkdtempSync(join(tmpdir(), "jazu_srv_"))
    const file = join(dir, "server.json")
    const tokens = { owner: make_token(), writer: make_token(), reader: make_token() }
    update_server_file(file, raw => Object.assign(raw, {
        repos_dir: "repos", state_dir: "state", site: { project: "jazu", dir: "site", branch: "master" },
        projects: { oldproj: { visibility: "public" }, secretproj: { visibility: "private" } },
        collaborators: { owner: { role: "owner", token_hash: hash_token(tokens.owner) }, writer: { role: "write", token_hash: hash_token(tokens.writer) }, reader: { role: "read", token_hash: hash_token(tokens.reader) } },
    }))
    const config = load_server_config(file)
    for (const id of ["jazu", "oldproj", "secretproj"]) {
        const bare = join(config.repos_dir, `${id}.git`)
        mkdirSync(bare, { recursive: true })
        execFileSync("git", ["init", "--bare", "--quiet", bare])
        git(bare, "symbolic-ref", "HEAD", "refs/heads/master")
    }
    return { dir, config, tokens, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

// A working clone with one commit pushed straight into the bare repository (bypassing HTTP and hooks' role checks).
function seed(config: Server_Config, id: string, files: Record<string, string> = { "readme.txt": "hello\n" }): string {
    const work = mkdtempSync(join(tmpdir(), "jazu_work_"))
    execFileSync("git", ["init", "--quiet", "-b", "master", work])
    for (const [name, text] of Object.entries(files)) { mkdirSync(join(work, name, ".."), { recursive: true }); writeFileSync(join(work, name), text) }
    git(work, "add", "-A")
    git(work, "commit", "-q", "-m", "first")
    execFileSync("git", ["-C", work, "push", "-q", join(config.repos_dir, `${id}.git`), "master"], { env: { ...process.env, JAZU_ROLE: "" }, stdio: "ignore" })
    return work
}

// What Cloudflare is to the real system: the Worker's route() in front of the node, over plain HTTP on loopback.
async function start_edge(config: Server_Config): Promise<{ url: string, close(): void }> {
    const node = personal_server({ secret, repositories: {}, port: 0, config })
    await once(node, "listening")
    const node_port = (node.address() as { port: number }).port
    const env = { DOMAIN: "example.com", PAGES_ORIGIN: "https://pages.example.dev", PUBLIC_PROJECTS: '["oldproj"]', PERSONAL_ORIGIN: `http://127.0.0.1:${node_port}`, ORIGIN_HMAC_SECRET: secret }
    const edge: Server = createServer(async (incoming, outgoing) => {
        const has_body = !["GET", "HEAD"].includes(incoming.method ?? "GET")
        const request = new Request(`http://127.0.0.1${incoming.url}`, { method: incoming.method, headers: incoming.headers as Record<string, string>, body: has_body ? Readable.toWeb(incoming) as ReadableStream : undefined, duplex: "half" } as RequestInit)
        const response = await worker.fetch(request, env)
        outgoing.writeHead(response.status, Object.fromEntries(response.headers))
        outgoing.end(Buffer.from(await response.arrayBuffer()))
    }).listen(0, "127.0.0.1")
    await once(edge, "listening")
    return { url: `http://127.0.0.1:${(edge.address() as { port: number }).port}`, close: () => { edge.close(); node.close(); edge.closeAllConnections(); node.closeAllConnections() } }
}

// Async on purpose: the servers under test live in this process, so a blocking git client would deadlock the event loop.
function try_git(cwd: string, ...args: string[]): Promise<{ ok: boolean, text: string }> {
    return new Promise(done => execFile("git", [...identity, "-C", cwd, ...args], { encoding: "utf8", timeout: 60_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1", HOME: cwd } }, (error, stdout, stderr) => done({ ok: !error, text: `${stdout}${stderr}`.trim() })))
}

test("tokens verify in constant shape and unknown users are rejected", () => {
    const f = fixture()
    try {
        assert.equal(verify_token(f.config, "owner", f.tokens.owner), "owner")
        assert.equal(verify_token(f.config, "owner", f.tokens.writer), null)
        assert.equal(verify_token(f.config, "nobody", f.tokens.owner), null)
        assert.equal(verify_token(f.config, "__proto__", "x"), null)
    } finally { f.cleanup() }
})

test("push policy: archived refused, writers cannot touch the deploy branch or tags, only the deploy branch queues a job", () => {
    const f = fixture()
    try {
        const updates = parse_updates(`${"0".repeat(40)} ${"a".repeat(40)} refs/heads/master\n${"0".repeat(40)} ${"b".repeat(40)} refs/heads/feature\n`)
        assert.match(check_push(f.config, "oldproj", "owner", updates) ?? "", /archived/)
        assert.match(check_push(f.config, "jazu", "write", updates) ?? "", /only owners/)
        assert.match(check_push(f.config, "jazu", "write", parse_updates(`${"0".repeat(40)} ${"a".repeat(40)} refs/tags/v1`)) ?? "", /only owners/)
        assert.equal(check_push(f.config, "jazu", "write", [updates[1]]), null)
        assert.equal(check_push(f.config, "jazu", "owner", updates), null)
        assert.equal(check_push(f.config, "jazu", undefined, updates), null)
        const jobs = jobs_for_push(f.config, "jazu", "owner", updates)
        assert.equal(jobs.length, 1)
        assert.equal(jobs[0].commit, "a".repeat(40))
        assert.deepEqual(jobs_for_push(f.config, "oldproj", "owner", updates), [])
    } finally { f.cleanup() }
})

test("queue is atomic, ordered, claimable once and recoverable", () => {
    const state = mkdtempSync(join(tmpdir(), "jazu_q_"))
    try {
        const a = enqueue(state, { kind: "push", project: "jazu", commit: "a" })
        const b = enqueue(state, { kind: "site_changed", project: "jazu" })
        assert.deepEqual(pending(state).map(item => item.job.id), [a.id, b.id])
        assert.equal(claim(state, `${a.id}.json`), true)
        assert.equal(claim(state, `${a.id}.json`), false)
        assert.equal(recover(state), 1)
        assert.equal(pending(state).length, 2)
        claim(state, `${a.id}.json`); finish(state, `${a.id}.json`)
        assert.equal(pending(state).length, 1)
        const batch = plan_batch([{ name: "1", job: { ...a, project: "jazu" } }, { name: "2", job: { ...a, id: "x", commit: "c" } }, { name: "3", job: b }])
        assert.deepEqual(batch.run.map(item => item.name), ["2"])
        assert.deepEqual(batch.superseded.map(item => item.name).sort(), ["1", "3"])
    } finally { rmSync(state, { recursive: true, force: true }) }
})

test("stream-signed requests verify only where streaming is allowed and cannot be downgraded", async () => {
    const request = new Request("https://origin/git-http/jazu.git/git-receive-pack", { method: "POST" })
    const headers = await sign_origin(request, secret, "git", Date.now(), "stream")
    assert.equal(await verify_origin(new Request(request, { headers }), secret, new Map()), false)
    assert.equal(await verify_origin(new Request(request, { headers }), secret, new Map(), Date.now(), true), true)
    const stripped = new Headers(headers); stripped.delete("x-jazu-body")
    assert.equal(await verify_origin(new Request(request, { headers: stripped }), secret, new Map(), Date.now(), true), false)
})

test("Worker: pushes and private reads go to the node as streams, public clones stay on Pages", async () => {
    const env = { DOMAIN: "example.com", PAGES_ORIGIN: "https://pages.example.dev", PUBLIC_PROJECTS: '["jazu"]', PERSONAL_ORIGIN: "https://node.example.net", ORIGIN_HMAC_SECRET: secret }
    const seen: Request[] = []
    const upstream = async (request: Request) => { seen.push(request); return new Response("ok") }
    await route(new Request("https://example.com/projects/jazu.git/info/refs?service=git-receive-pack", { headers: { authorization: "Basic abc", cookie: "secret" } }), env, upstream)
    assert.equal(seen[0].url, "https://node.example.net/git-http/jazu.git/info/refs?service=git-receive-pack")
    assert.equal(seen[0].headers.get("authorization"), "Basic abc")
    assert.equal(seen[0].headers.get("cookie"), null)
    assert.equal(seen[0].headers.get("x-jazu-body"), "stream")
    await route(new Request("https://example.com/projects/jazu.git/info/refs?service=git-upload-pack"), env, upstream)
    assert.equal(seen[1].url, "https://pages.example.dev/projects/jazu.git/info/refs?service=git-upload-pack")
    await route(new Request("https://example.com/projects/hidden.git/info/refs?service=git-upload-pack"), env, upstream)
    assert.equal(seen[2].url, "https://node.example.net/git-http/hidden.git/info/refs?service=git-upload-pack")
    assert.equal((await route(new Request("https://example.com/projects/jazu.git/git-receive-pack"), env, upstream)).status, 405)
    assert.equal((await route(new Request("https://example.com/projects/jazu.git/git-receive-pack", { method: "POST", body: "x" }), { ...env, PERSONAL_ORIGIN: undefined }, upstream)).status, 503)
})

test("end to end: owner pushes through Worker -> node -> git http-backend; hooks enforce roles and queue CI", async () => {
    const f = fixture()
    const edge = await start_edge(f.config)
    const work = seed(f.config, "jazu")
    install_hooks(f.config)
    const remote = (user: string, project = "jazu") => `http://${user}:${f.tokens[user as keyof typeof f.tokens] ?? "bad"}@${edge.url.slice("http://".length)}/projects/${project}.git`
    try {
        git(work, "commit", "-q", "--allow-empty", "-m", "second")
        const pushed = await try_git(work, "push", remote("owner"), "master")
        assert.equal(pushed.ok, true, pushed.text)
        const queued = pending(f.config.state_dir)
        assert.equal(queued.length, 1)
        assert.equal(queued[0].job.commit, git(work, "rev-parse", "HEAD"))
        assert.equal(queued[0].job.pusher, "owner")

        assert.equal((await try_git(work, "push", remote("nobody"), "master")).ok, false)
        assert.equal((await try_git(work, "push", remote("reader"), "master")).ok, false)

        git(work, "checkout", "-q", "-b", "feature")
        git(work, "commit", "-q", "--allow-empty", "-m", "wip")
        assert.equal((await try_git(work, "push", remote("writer"), "feature")).ok, true)
        assert.equal(pending(f.config.state_dir).length, 1, "a collaborator branch must not queue CI")
        git(work, "checkout", "-q", "master")
        git(work, "commit", "-q", "--allow-empty", "-m", "third")
        const refused = await try_git(work, "push", remote("writer"), "master")
        assert.equal(refused.ok, false)
        assert.match(refused.text, /only owners/)

        git(work, "reset", "-q", "--hard", "HEAD~2")
        assert.equal((await try_git(work, "push", "--force", remote("owner"), "master")).ok, false, "history rewrite of the deploy branch must be refused")

        assert.equal((await try_git(work, "push", remote("owner", "oldproj"), "master")).ok, false, "archived project refuses pushes")
        assert.match((await try_git(work, "push", remote("owner", "oldproj"), "master")).text, /archived|403/)

        const clone = mkdtempSync(join(tmpdir(), "jazu_clone_"))
        assert.equal((await try_git(clone, "clone", "-q", remote("nobody", "secretproj"), join(clone, "x"))).ok, false, "private repositories need a valid token even to clone")
        assert.equal((await try_git(clone, "clone", "-q", remote("reader", "secretproj"), join(clone, "y"))).ok, true)
        assert.equal((await try_git(clone, "ls-remote", remote("nobody", "secretproj"))).ok, false)
        assert.equal((await try_git(clone, "ls-remote", remote("reader", "secretproj"))).ok, true)
        rmSync(clone, { recursive: true, force: true })
    } finally { edge.close(); f.cleanup(); rmSync(work, { recursive: true, force: true }) }
})

test("static mirror serves a working clone over dumb HTTP and publishes only the allow-list", async () => {
    const f = fixture()
    const work = seed(f.config, "jazu", { "a.txt": "A\n", "dir/b.txt": "B\n" })
    seed(f.config, "oldproj")
    try {
        const bare = join(f.config.repos_dir, "jazu.git")
        git(work, "checkout", "-q", "-b", "wip")
        git(work, "commit", "-q", "--allow-empty", "-m", "private wip")
        execFileSync("git", ["-C", work, "push", "-q", bare, "wip"], { stdio: "ignore" })
        const tip = git(bare, "rev-parse", "refs/heads/master")
        const first = refresh_mirror(f.config, "jazu", tip)
        assert.equal(first.status, "updated")
        assert.equal(refresh_mirror(f.config, "jazu", tip).status, "unchanged")
        assert.equal(refresh_mirror(f.config, "oldproj").status, "updated")
        assert.equal(refresh_mirror(f.config, "secretproj").status, "skipped")

        const root = join(f.config.state_dir, "mirror")
        const published = readdirSync(join(root, "projects/jazu.git"), { recursive: true }).map(String).sort()
        assert(published.includes("HEAD") && published.includes("info/refs") && published.includes("objects/info/packs"))
        assert(!published.includes("config") && !published.some(name => name.startsWith("hooks")))
        assert(!readFileSync(join(root, "projects/jazu.git/info/refs"), "utf8").includes("refs/heads/wip"), "collaborator branches stay private")

        const files = createServer((request, response) => {
            const path = join(root, decodeURIComponent((request.url ?? "").split("?")[0]))
            if (!path.startsWith(root) || !existsSync(path) || !readdirSync(join(path, "..")).includes(path.split("/").pop()!)) { response.writeHead(404); response.end(); return }
            try { response.writeHead(200, { "content-type": "text/plain" }); response.end(readFileSync(path)) } catch { response.end() }
        }).listen(0, "127.0.0.1")
        await once(files, "listening")
        const clone = mkdtempSync(join(tmpdir(), "jazu_dumb_"))
        const url = `http://127.0.0.1:${(files.address() as { port: number }).port}/projects/jazu.git`
        const cloned = await try_git(clone, "clone", "-q", url, join(clone, "out"))
        files.close(); files.closeAllConnections()
        assert.equal(cloned.ok, true, cloned.text)
        assert.equal(readFileSync(join(clone, "out/dir/b.txt"), "utf8"), "B\n")
        assert.equal(git(join(clone, "out"), "rev-parse", "HEAD"), tip)
        rmSync(clone, { recursive: true, force: true })
    } finally { f.cleanup(); rmSync(work, { recursive: true, force: true }) }
})

test("publish staging adds the mirror overlay, refuses collisions and fingerprints content", () => {
    const root = mkdtempSync(join(tmpdir(), "jazu_pub_"))
    try {
        mkdirSync(join(root, "dist"), { recursive: true })
        writeFileSync(join(root, "dist/index.html"), "home")
        writeFileSync(join(root, "dist/.jazu_output.json"), JSON.stringify(["index.html"]))
        mkdirSync(join(root, "overlay/projects/p.git"), { recursive: true })
        writeFileSync(join(root, "overlay/projects/p.git/HEAD"), "ref: refs/heads/master\n")
        const one = stage_pages(root, join(root, "dist"), 1000, join(root, "overlay"))
        assert(existsSync(join(one.pages, "projects/p.git/HEAD")))
        const print_one = fingerprint_pages(one.pages, one.uploads)
        const two = stage_pages(root, join(root, "dist"), 1000, join(root, "overlay"))
        assert.equal(fingerprint_pages(two.pages, two.uploads), print_one)
        writeFileSync(join(root, "overlay/projects/p.git/HEAD"), "ref: refs/heads/main\n")
        const three = stage_pages(root, join(root, "dist"), 1000, join(root, "overlay"))
        assert.notEqual(fingerprint_pages(three.pages, three.uploads), print_one)
        mkdirSync(join(root, "overlay2"), { recursive: true })
        writeFileSync(join(root, "overlay2/index.html"), "evil")
        assert.throws(() => stage_pages(root, join(root, "dist"), 1000, join(root, "overlay2")), /collides/)

        const state_file = join(root, "published.json")
        const dry = publish_pages(root, join(root, "dist"), "proj", { overlay_dir: join(root, "overlay"), state_file, dry_run: true })
        assert.equal(dry.reason, "dry_run")
        writeFileSync(state_file, JSON.stringify({ fingerprint: dry.fingerprint }))
        const same = publish_pages(root, join(root, "dist"), "proj", { overlay_dir: join(root, "overlay"), state_file })
        assert.deepEqual([same.deployed, same.reason], [false, "unchanged"])
        assert(!existsSync(join(root, ".cache/deploy")) || readdirSync(join(root, ".cache/deploy")).length === 3, "publish removes its own staging folder")
    } finally { rmSync(root, { recursive: true, force: true }) }
})

// A site working copy whose "publish" is a script that records its flags, so CD can be observed without Cloudflare.
function pipeline_fixture() {
    const f = fixture()
    const files = { "package.json": "{}", "fake_publish.mjs": `import { appendFileSync, existsSync } from "node:fs"\nappendFileSync("../publish.log", process.argv.slice(2).join(" ") + "\\n")\nconst quiet = existsSync("../no_deploy")\nconsole.log('JAZU_PUBLISH ' + JSON.stringify({ deployed: !quiet, reason: quiet ? "unchanged" : "changed" }))\n` }
    const work = seed(f.config, "jazu", files)
    execFileSync("git", ["clone", "-q", join(f.config.repos_dir, "jazu.git"), f.config.site.dir])
    const ok = (name: string) => ({ name, command: process.execPath, args: ["-e", "process.exit(0)"] })
    const steps = (failing?: string): Pipeline_Steps => ({
        install: ok("install"),
        ci: ["types", "tests", "content check"].map(name => name === failing ? { name, command: process.execPath, args: ["-e", "console.error('boom'); process.exit(1)"] } : ok(name)),
        publish: { name: "publish", command: process.execPath, args: ["fake_publish.mjs"] },
    })
    const push_commit = (message: string) => {
        git(work, "commit", "-q", "--allow-empty", "-m", message)
        execFileSync("git", ["-C", work, "push", "-q", join(f.config.repos_dir, "jazu.git"), "master"], { stdio: "ignore" })
        return git(work, "rev-parse", "HEAD")
    }
    return { f, work, steps, push_commit, cleanup: () => { f.cleanup(); rmSync(work, { recursive: true, force: true }) } }
}

async function execute(p: ReturnType<typeof pipeline_fixture>, commit: string | undefined, steps: Pipeline_Steps, env: NodeJS.ProcessEnv = {}): Promise<{ record: Run_Record, log: string }> {
    const job = enqueue(p.f.config.state_dir, commit ? { kind: "push", project: "jazu", commit, ref: "refs/heads/master", pusher: "owner" } : { kind: "site_changed", project: "jazu" })
    const record: Run_Record = { id: job.id, kind: job.kind, project: "jazu", state: "queued", queued_at: job.queued_at, commit, steps: [] }
    let log = ""
    await run_pipeline(p.f.config, job, record, text => { log += text }, () => {}, steps, { ...env, CLOUDFLARE_API_TOKEN: "t", CLOUDFLARE_ACCOUNT_ID: "a" })
    return { record, log }
}

test("pipeline: green commit passes CI, advances the working copy, mirrors, and deploys", async () => {
    const p = pipeline_fixture()
    const publish_log = join(p.f.dir, "publish.log")
    try {
        const commit = p.push_commit("feat: green")
        const { record, log } = await execute(p, commit, p.steps())
        assert.equal(record.state, "passed", log)
        assert.equal(record.deployed, true)
        assert.deepEqual(record.steps.map(step => step.name), ["types", "tests", "content check", "publish"])
        assert.equal(git(p.f.config.site.dir, "rev-parse", "HEAD"), commit)
        const flags = readFileSync(publish_log, "utf8")
        assert.match(flags, /--overlay .*mirror/)
        assert.match(flags, new RegExp(`--commit ${commit}`))
        assert(existsSync(join(p.f.config.state_dir, "mirror/projects/jazu.git/info/refs")))
        assert.equal(record.mirrors?.find(item => item.id === "jazu")?.status, "updated")
        assert.equal(JSON.parse(readFileSync(join(p.f.config.state_dir, "last_green.json"), "utf8")).commit, commit)
    } finally { p.cleanup() }
})

test("pipeline: a failing test refuses the commit; nothing is deployed and the working copy does not move", async () => {
    const p = pipeline_fixture()
    try {
        const before = git(p.f.config.site.dir, "rev-parse", "HEAD")
        const commit = p.push_commit("feat: broken")
        const { record, log } = await execute(p, commit, p.steps("tests"))
        assert.equal(record.state, "failed")
        assert.match(record.message ?? "", /CI failed at "tests"/)
        assert.deepEqual(record.steps.map(step => step.name), ["types", "tests"], "later steps and publish must not run")
        assert.match(log, /boom/)
        assert.equal(git(p.f.config.site.dir, "rev-parse", "HEAD"), before)
        assert.equal(record.deployed, undefined)
        assert(!existsSync(join(p.f.config.state_dir, "last_green.json")))
    } finally { p.cleanup() }
})

test("pipeline: unchanged output is not deployed; dirty working copy blocks the push CD but not the file-change CD", async () => {
    const p = pipeline_fixture()
    try {
        const commit = p.push_commit("chore: nothing changes")
        writeFileSync(join(p.f.dir, "no_deploy"), "")
        const quiet = await execute(p, commit, p.steps())
        assert.equal(quiet.record.state, "passed", quiet.log)
        assert.equal(quiet.record.deployed, false)
        assert.match(quiet.record.message ?? "", /nothing to deploy/)

        writeFileSync(join(p.f.config.site.dir, "package.json"), '{"edited":true}')
        const watched = await execute(p, undefined, p.steps())
        assert.equal(watched.record.state, "passed", watched.log)
        assert.deepEqual(watched.record.steps.map(step => step.name), ["publish"], "file-change jobs skip CI")

        const next = p.push_commit("feat: while dirty")
        const blocked = await execute(p, next, p.steps())
        assert.equal(blocked.record.state, "failed")
        assert.match(blocked.record.message ?? "", /uncommitted changes/)
        assert.equal(readFileSync(join(p.f.config.site.dir, "package.json"), "utf8"), '{"edited":true}', "local edits are never overwritten")
    } finally { p.cleanup() }
})

test("pipeline children never see server secrets", async () => {
    const p = pipeline_fixture()
    process.env.ORIGIN_HMAC_SECRET = "must_not_leak"
    try {
        const dump = join(p.f.dir, "env.json")
        const steps = p.steps()
        steps.ci[0] = { name: "types", command: process.execPath, args: ["-e", `require("fs").writeFileSync(${JSON.stringify(dump)}, JSON.stringify(process.env))`] }
        const commit = p.push_commit("chore: env")
        await execute(p, commit, steps)
        const seen = JSON.parse(readFileSync(dump, "utf8"))
        assert.equal(seen.ORIGIN_HMAC_SECRET, undefined)
        assert.equal(seen.CLOUDFLARE_API_TOKEN, undefined)
        assert.equal(seen.CI, "true")
    } finally { delete process.env.ORIGIN_HMAC_SECRET; p.cleanup() }
})

test("public run list hides pushers, messages and paths", () => {
    const state = mkdtempSync(join(tmpdir(), "jazu_runs_"))
    try {
        mkdirSync(join(state, "runs"), { recursive: true })
        writeFileSync(join(state, "runs/1.json"), JSON.stringify({ id: "1", kind: "push", project: "jazu", state: "failed", queued_at: 1, pusher: "owner", message: "/srv/jazu dirty", steps: [{ name: "tests", ok: false, code: 1, ms: 5 }] }))
        const [run] = list_runs(state, "jazu", 5)
        assert.equal(run.state, "failed")
        assert.equal("pusher" in run, false)
        assert.equal("message" in run, false)
    } finally { rmSync(state, { recursive: true, force: true }) }
})
