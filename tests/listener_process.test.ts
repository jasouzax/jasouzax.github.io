/* Real subprocess/Git regressions for schema upgrades, worker failures and listener restart handoff. */
import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync, spawn } from "node:child_process"
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { load_server_config, repository_path } from "../src/node/server_config.ts"
import { sync_repositories } from "../src/node/git_hooks.ts"
import { enqueue, pending } from "../src/node/queue.ts"
import { list_runs, start_runner } from "../src/node/runner.ts"
import { listener_fingerprint, listener_updated } from "../src/node/job_process.ts"
import { parse_xml } from "../src/xml.ts"
import { validate_roots } from "../src/schema.ts"
import { new_diagnostics } from "../src/diag.ts"

function git(dir: string, ...args: string[]): string {
    return execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()
}

function fixture(catalog_failure = false, staging = false) {
    // Keep fixtures below the workspace so dependency lookup works without network installation.
    mkdirSync(".cache", { recursive: true })
    const root = mkdtempSync(join(process.cwd(), ".cache/listener_test_"))
    const engine = join(root, "engine")
    mkdirSync(join(engine, "content"), { recursive: true })
    mkdirSync(join(engine, "src/node"), { recursive: true })
    for (const file of ["xml.ts", "schema.ts", "diag.ts", "plugin_types.ts", "pipeline_types.ts", ...["job_main", "pipeline", "pipeline_process", "server_config", "project_catalog", "git_mirror", "queue", "repo_sync"].map(name => `node/${name}.ts`)]) cpSync(join("src", file), join(engine, "src", file))
    if (catalog_failure) {
        const worker = join(engine, "src/node/job_main.ts")
        writeFileSync(worker, 'if (process.argv[2] === "catalog") { console.error("catalog unavailable"); process.exit(12) }\n' + readFileSync(worker, "utf8"))
    }
    writeFileSync(join(engine, "package.json"), '{"type":"module"}')
    writeFileSync(join(engine, "content/projects.xml"), '<project id="engine" name="Engine" date="2026"><pipeline><step name="old" command="node" args=\'["old.mjs"]\'/></pipeline>' + (staging ? '<pipeline branch="staging"><step name="staging" command="node" args=\'["old.mjs"]\'/></pipeline>' : '') + '</project>')
    writeFileSync(join(engine, "old.mjs"), "process.exit(77)")
    git(engine, "init", "-q", "-b", "master")
    git(engine, "add", ".")
    git(engine, "commit", "-qm", "initial engine")
    const old = git(engine, "rev-parse", "HEAD")
    const file = join(root, "server.json")
    writeFileSync(file, JSON.stringify({ repos_dir: "repos", state_dir: "state", site: { project: "engine", dir: "engine", branch: "master" } }))
    const config = load_server_config(file)
    sync_repositories(config)
    const hub = repository_path(config, "engine")
    git(hub, "fetch", "-q", engine, "master:master")
    const author = join(root, "author")
    git(root, "clone", "-q", engine, author)
    const publish = () => {
        git(author, "add", ".")
        git(author, "commit", "-qm", "update engine")
        git(hub, "fetch", "-q", author, "+master:master")
        return git(author, "rev-parse", "HEAD")
    }
    return { root, engine, author, config, old, publish, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

async function idle(runner: ReturnType<typeof start_runner>): Promise<void> {
    const deadline = Date.now() + 120000
    while (runner.busy() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20))
    assert(!runner.busy(), "listener did not become idle")
}

test("incoming engine uses its own new schema, pipeline commands and implementation, then requests one idle restart", { timeout: 180000 }, async () => {
    const f = fixture()
    let runner: ReturnType<typeof start_runner> | undefined
    try {
        const xml = '<project id="engine" name="Engine" date="2026"><pipeline><step name="new schema" command="node" args=\'["verify.mjs"]\'/></pipeline></project><event id="new" name="New" date="2026" listener_new="true"/>'
        const diag = new_diagnostics()
        validate_roots(parse_xml(xml, "future.xml"), diag)
        assert(diag.errors.some(error => error.includes('unknown attribute "listener_new"')))
        const schema = join(f.author, "src/schema.ts")
        writeFileSync(schema, readFileSync(schema, "utf8").replaceAll('"resume_end"', '"resume_end", "listener_new"'))
        writeFileSync(join(f.author, "content/projects.xml"), xml)
        writeFileSync(join(f.author, "verify.mjs"), `import fs from 'node:fs'; import assert from 'node:assert/strict'; import {parse_xml} from './src/xml.ts'; import {validate_roots} from './src/schema.ts'; import {new_diagnostics} from './src/diag.ts'; const d=new_diagnostics(); validate_roots(parse_xml(fs.readFileSync('content/projects.xml','utf8'),'projects.xml'),d); assert.deepEqual(d.errors,[]); assert.equal(process.env.PRIVATE_SECRET,undefined);`)
        const pipeline = join(f.author, "src/node/pipeline.ts")
        writeFileSync(pipeline, readFileSync(pipeline, "utf8").replace('record.state = "running"', 'log("candidate implementation loaded\\n"); record.state = "running"'))
        const commit = f.publish()
        const job = enqueue(f.config.state_dir, { kind: "push", project: "engine", commit })
        let restarts = 0
        runner = start_runner(f.config, { poll_ms: 100000, server_env: { ...process.env, PRIVATE_SECRET: "hidden" }, on_restart: () => { restarts++ } })
        await idle(runner)
        const result = list_runs(f.config.state_dir, "engine", 1)[0]
        assert.equal(result.state, "passed", JSON.stringify(result))
        assert.equal(result.steps?.[0].name, "new schema")
        assert(readFileSync(join(f.config.state_dir, "runs", `${job.id}.log`), "utf8").includes("candidate implementation loaded"))
        assert.equal(git(f.engine, "rev-parse", "HEAD"), commit)
        assert.equal(restarts, 1)
        await runner.drain()
        assert.equal(restarts, 1)
        assert.equal(pending(f.config.state_dir).length, 0)
    } finally { runner?.stop(); f.cleanup() }
})

test("a crashing incoming worker is recorded once and a later corrective commit still runs", { timeout: 180000 }, async () => {
    const f = fixture()
    let runner: ReturnType<typeof start_runner> | undefined
    try {
        const worker = join(f.author, "src/node/job_main.ts")
        const good_worker = readFileSync(worker, "utf8")
        writeFileSync(worker, 'console.error("broken worker"); process.exit(42)')
        const failed = f.publish()
        enqueue(f.config.state_dir, { kind: "push", project: "engine", commit: failed })
        runner = start_runner(f.config, { server_env: {}, poll_ms: 100000 })
        await idle(runner)
        assert.equal(list_runs(f.config.state_dir, "engine", 1)[0].state, "failed")
        assert.equal(git(f.engine, "rev-parse", "HEAD"), f.old)
        assert.equal(pending(f.config.state_dir).length, 0)
        writeFileSync(worker, good_worker)
        writeFileSync(join(f.author, "old.mjs"), "process.exit(0)")
        const fixed = f.publish()
        enqueue(f.config.state_dir, { kind: "push", project: "engine", commit: fixed })
        await runner.drain()
        await idle(runner)
        const results = list_runs(f.config.state_dir, "engine", 10)
        assert.equal(results.length, 2)
        assert.equal(results[0].state, "passed")
        assert.equal(git(f.engine, "rev-parse", "HEAD"), fixed)
    } finally { runner?.stop(); f.cleanup() }
})

test("failed catalog reload cannot block a queued corrective commit; content alone does not change the listener fingerprint", { timeout: 180000 }, async () => {
    const f = fixture(true)
    let runner: ReturnType<typeof start_runner> | undefined
    try {
        const fingerprint = listener_fingerprint(f.engine)
        writeFileSync(join(f.engine, "content/projects.xml"), '<project invalid="true"/>')
        assert.equal(listener_fingerprint(f.engine), fingerprint)
        git(f.engine, "checkout", "--", "content/projects.xml")
        const worker = join(f.author, "src/node/job_main.ts")
        writeFileSync(worker, readFileSync(worker, "utf8").split("\n").slice(1).join("\n"))
        writeFileSync(join(f.author, "old.mjs"), "process.exit(0)")
        const commit = f.publish()
        enqueue(f.config.state_dir, { kind: "push", project: "engine", commit })
        runner = start_runner(f.config, { poll_ms: 100000 })
        await idle(runner)
        assert.equal(list_runs(f.config.state_dir, "engine", 1)[0].state, "passed")
        assert(existsSync(join(f.config.state_dir, "runtime/src/node/job_main.ts")))
    } finally { runner?.stop(); f.cleanup() }
})

test("the real node service exits 75 for its supervisor after listener runtime changes", { timeout: 60000 }, async () => {
    const f = fixture()
    const fingerprint = listener_fingerprint(f.engine)
    const child = spawn(process.execPath, ["src/main.ts", "node", "--root", f.engine, "--config", f.config.file, "--port", "0"], { env: { ...process.env, ORIGIN_HMAC_SECRET: "test-secret-for-listener-restart-123456789" }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] })
    let output = ""
    let changed = false
    let dirty_restart = false
    const timer = setTimeout(() => child.kill(), 45000)
    try {
        child.stdout.on("data", chunk => {
            output += chunk
            if (!changed && output.includes("personal node listening")) {
                changed = true
                appendFileSync(join(f.engine, "src/schema.ts"), "\n// accepted runtime update\n")
                dirty_restart = listener_updated(f.engine, fingerprint)
                git(f.engine, "add", "src/schema.ts")
                git(f.engine, "commit", "-qm", "update runtime")
            }
        })
        child.stderr.on("data", chunk => { output += chunk })
        const code = await new Promise<number | null>((resolve, reject) => { child.once("close", resolve); child.once("error", reject) })
        assert.equal(code, 75, output)
        assert.equal(dirty_restart, false, "uncommitted source edits must not restart the listener")
        assert(output.includes("restarting before the next job"), output)
        assert.equal(pending(f.config.state_dir).length, 0)
    } finally {
        clearTimeout(timer)
        child.kill()
        f.cleanup()
    }
})

test("an engine staging job uses its own branch and rejects workers without branch capabilities", { timeout: 180000 }, async () => {
    const f = fixture(false, true)
    let runner: ReturnType<typeof start_runner> | undefined
    try {
        git(f.author, "switch", "-c", "staging")
        writeFileSync(join(f.author, "old.mjs"), "process.exit(0)")
        const queue = () => {
            git(f.author, "add", ".")
            git(f.author, "commit", "-qm", "update staging")
            git(repository_path(f.config, "engine"), "fetch", "-q", f.author, "+staging:staging")
            const commit = git(f.author, "rev-parse", "HEAD")
            enqueue(f.config.state_dir, { kind: "push", project: "engine", commit, ref: "refs/heads/staging" })
            return commit
        }
        const approved = queue()
        runner = start_runner(f.config, { poll_ms: 100000 })
        await idle(runner)
        assert.equal(list_runs(f.config.state_dir, "engine", 1, "staging")[0].state, "passed")
        assert.equal(git(f.engine, "branch", "--show-current"), "staging")
        assert.equal(git(f.engine, "rev-parse", "master"), f.old)
        const worker = join(f.author, "src/node/job_main.ts")
        writeFileSync(worker, readFileSync(worker, "utf8").replace("branch_pipelines: true", "branch_pipelines: false"))
        queue()
        await runner.drain()
        await idle(runner)
        assert.equal(list_runs(f.config.state_dir, "engine", 1, "staging")[0].state, "failed")
        assert.equal(git(f.engine, "rev-parse", "HEAD"), approved)
    } finally { runner?.stop(); f.cleanup() }
})
