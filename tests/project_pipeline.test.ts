/* Real Git integration tests for XML-defined, provider-independent, multi-project synchronization and CI/CD. */
import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { parse_xml } from "../src/xml.ts"
import { validate_roots } from "../src/schema.ts"
import { new_diagnostics } from "../src/diag.ts"
import { load_config } from "../src/config.ts"
import { load_site } from "../src/model.ts"
import { is_active, load_server_config, project_view, repository_path } from "../src/node/server_config.ts"
import type { Server_Config } from "../src/node/server_config.ts"
import { check_push, jobs_for_push, sync_repositories } from "../src/node/git_hooks.ts"
import { claim, finish, pending } from "../src/node/queue.ts"
import type { Job } from "../src/node/queue.ts"
import { poll_project, read_sync_state } from "../src/node/repo_sync.ts"
import { run_pipeline } from "../src/node/pipeline.ts"
import type { Run_Record } from "../src/node/pipeline.ts"
import { list_runs, start_runner } from "../src/node/runner.ts"
import { route } from "../src/node/worker.ts"
import { refresh_mirrors } from "../src/node/git_mirror.ts"

function git(path: string, ...args: string[]): string {
    return execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-C", path, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()
}

const attribute = (value: string) => value.replace(/&/g, "&amp;").replace(/'/g, "&apos;").replace(/</g, "&lt;")
function declaration(id: string, branch: string, private_project = false): string {
    const step = (phase: string) => `<step name="${phase}" phase="${phase}" command="node" args='${attribute(JSON.stringify(["phase.mjs", phase, "${commit}", "${project}"]))}'${phase === "deploy" ? ' credentials="DEPLOY_TOKEN"' : ""}/>`
    return `<project id="${id}" name="${id}" date="Jan 2026" repo="git.example/${id}" private="${private_project}"><pipeline branch="${branch}" poll_seconds="10">${["ci", "build", "deploy"].map(step).join("")}</pipeline></project>`
}

function fixture() {
    const root = mkdtempSync(join(tmpdir(), "jazu_projects_"))
    const engine = join(root, "engine")
    mkdirSync(join(engine, "content"), { recursive: true })
    const xml = declaration("alpha", "main") + declaration("beta", "release", true)
    writeFileSync(join(engine, "content/projects.xml"), xml)
    git(engine, "init", "-q", "-b", "master")
    git(engine, "add", ".")
    git(engine, "commit", "-q", "-m", "engine catalog")
    const file = join(root, "server.json")
    writeFileSync(file, JSON.stringify({ repos_dir: "repos", state_dir: "state", site: { project: "engine", dir: "engine", branch: "master" }, projects: { archived: { visibility: "public" } } }))
    const config = load_server_config(file)
    sync_repositories(config)
    // Seed the engine before attaching hooks so only the project workflows below are queued.
    git(repository_path(config, "engine"), "fetch", "-q", engine, "master:master")
    const remotes: Record<string, { bare: string, work: string, commit: string }> = {}
    for (const [id, branch] of [["alpha", "main"], ["beta", "release"]]) {
        const work = join(root, `${id}_upstream`)
        const bare = join(root, `${id}_upstream.git`)
        mkdirSync(work)
        git(work, "init", "-q", "-b", branch)
        writeFileSync(join(work, "phase.mjs"), `import assert from 'node:assert/strict'; import fs from 'node:fs'; const [phase,commit,project] = process.argv.slice(2); if (phase !== 'deploy') assert.equal(process.env.DEPLOY_TOKEN, undefined); assert.equal(process.env.OTHER_SECRET, undefined); if (phase === 'ci' && fs.existsSync('fail-ci')) process.exit(1); if (phase === 'build') fs.writeFileSync('built.txt','ready'); if (phase === 'deploy') { assert.equal(process.env.DEPLOY_TOKEN,'test-secret'); assert.equal(fs.readFileSync('built.txt','utf8'),'ready'); fs.writeFileSync('deployment.json', JSON.stringify({commit,project})); }`)
        writeFileSync(join(work, ".gitignore"), "built.txt\ndeployment.json\n")
        git(work, "add", ".")
        git(work, "commit", "-q", "-m", `initial ${id}`)
        git(work, "clone", "--bare", "-q", work, bare)
        // Git's URL rewrite redirects the provider URL to a local bare remote; no real network is used.
        git(repository_path(config, id), "config", `url.${bare.replace(/\\/g, "/")}.insteadOf`, `https://git.example/${id}`)
        remotes[id] = { bare, work, commit: git(work, "rev-parse", "HEAD") }
    }
    return { root, engine, file, config, remotes, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

async function execute(config: Server_Config, job: Job): Promise<Run_Record> {
    assert(claim(config.state_dir, `${job.id}.json`))
    const record: Run_Record = { id: job.id, kind: job.kind, project: job.project, commit: job.commit, state: "queued", queued_at: job.queued_at, steps: [] }
    await run_pipeline(config, job, record, () => {}, () => {}, undefined, { DEPLOY_TOKEN: "test-secret", OTHER_SECRET: "not-allowed" })
    finish(config.state_dir, `${job.id}.json`)
    return record
}

test("pipeline schema validates commands, argument arrays, phases, secrets and repository URLs", () => {
    for (const body of [
        '<pipeline/><pipeline/>',
        '<pipeline branch="../bad"/>',
        '<pipeline><step name="x" command="node" args="not-json"/></pipeline>',
        '<pipeline><step name="x" command="node" args="[1]"/></pipeline>',
        '<pipeline><step name="x" command="node" credentials="TOKEN"/></pipeline>',
        '<pipeline><step name="x" phase="deploy" command="node"/><step name="y" command="node"/></pipeline>',
        '<pipeline><step name="x" command="node" args=\'["${SECRET}"]\'/></pipeline>',
        '<pipeline dir="/private/server/path"/>',
        '<pipeline><step name="x" command="node"/><step name="x" command="node"/></pipeline>',
    ]) {
        const diag = new_diagnostics()
        validate_roots(parse_xml(`<project id="app" name="App" date="2026">${body}</project>`, "test.xml"), diag)
        assert(diag.errors.length > 0, body)
    }
    const diag = new_diagnostics()
    validate_roots(parse_xml('<project id="app" name="App" date="2026" repo="https://user:secret@git.example/repo"/>', "test.xml"), diag)
    assert(diag.errors.some(error => error.includes("credential-free")))
})

test("catalog registers independent projects, branches and paths; archive and role rules remain enforced", async () => {
    const f = fixture()
    try {
        const alpha = project_view(f.config, "alpha")
        const beta = project_view(f.config, "beta")
        assert.equal(alpha.upstream?.remote, "https://git.example/alpha")
        assert.equal(alpha.site.branch, "main")
        assert.equal(beta.site.branch, "release")
        assert.notEqual(alpha.state_dir, beta.state_dir)
        assert.notEqual(alpha.site.dir, beta.site.dir)
        assert.equal(f.config.projects.beta.visibility, "private")
        assert.equal(is_active(f.config, "archived"), false)
        assert.equal(is_active(f.config, "alpha"), true)
        const update = [{ old: "0".repeat(40), new: "a".repeat(40), ref: "refs/heads/main" }]
        assert.match(check_push(f.config, "alpha", "write", update)!, /only owners/)
        assert.equal(jobs_for_push(f.config, "alpha", "owner", update)[0].project, "alpha")
        assert.equal(jobs_for_push(f.config, "beta", "owner", update).length, 0)
        const model = load_site(f.engine, await load_config(process.cwd()), new_diagnostics(), new Date("2026-01-01"))
        const page = model.pages.find(page => page.path === "/projects/alpha")!
        assert.equal(page.node.attrs.repo, undefined)
        assert(!page.node.children.some(node => node.tag === "pipeline"))
    } finally { f.cleanup() }
})

test("multiple upstreams bootstrap empty hubs and run XML pipelines with isolated state and deploy-only credentials", async () => {
    const f = fixture()
    try {
        for (const id of ["alpha", "beta"]) assert.equal((await poll_project(project_view(f.config, id)))?.status, "imported")
        assert.deepEqual(pending(f.config.state_dir).map(item => item.job.project), ["alpha", "beta"])
        for (const id of ["alpha", "beta"]) {
            const job = pending(f.config.state_dir).find(item => item.job.project === id)!.job
            const result = await execute(f.config, job)
            assert.equal(result.state, "passed", result.message ?? "pipeline did not pass")
            assert.deepEqual(result.steps.map(step => step.name), ["ci", "upstream sync", "build", "deploy"])
            const view = project_view(f.config, id)
            const deployment = JSON.parse(readFileSync(join(view.site.dir, "deployment.json"), "utf8"))
            assert.deepEqual(deployment, { commit: f.remotes[id].commit, project: id })
            assert.equal(read_sync_state(view)?.commit, f.remotes[id].commit)
            assert(existsSync(join(view.state_dir, "last_green.json")))
        }
        assert(readFileSync(join(f.config.state_dir, "mirror/projects/alpha.git/info/refs"), "utf8").includes(f.remotes.alpha.commit))
        assert(!existsSync(join(f.config.state_dir, "mirror/projects/beta.git")))
        assert(pending(f.config.state_dir).some(item => item.job.project === "engine" && item.job.kind === "site_changed"))
        for (const id of ["alpha", "beta"]) await poll_project(project_view(f.config, id))
        assert(!pending(f.config.state_dir).some(item => ["alpha", "beta"].includes(item.job.project)), "matching tips must not loop")
    } finally { f.cleanup() }
})

test("commits made directly in a project checkout are tested before reaching its external repository", async () => {
    const f = fixture()
    try {
        const view = project_view(f.config, "alpha")
        await poll_project(view)
        await execute(f.config, pending(f.config.state_dir).find(item => item.job.project === "alpha")!.job)
        writeFileSync(join(view.site.dir, "local.txt"), "owner's committed change")
        git(view.site.dir, "add", "local.txt")
        git(view.site.dir, "commit", "-q", "-m", "feat: local checkout change")
        const commit = git(view.site.dir, "rev-parse", "HEAD")
        await poll_project(view)
        assert.equal(git(f.remotes.alpha.bare, "rev-parse", "main"), f.remotes.alpha.commit)
        const job = pending(f.config.state_dir).find(item => item.job.project === "alpha")!.job
        assert.equal(job.kind, "push")
        assert.equal(job.commit, commit)
        assert.equal((await execute(f.config, job)).state, "passed")
        assert.equal(git(f.remotes.alpha.bare, "rev-parse", "main"), commit)
        writeFileSync(join(view.site.dir, "local.txt"), "uncommitted")
        await poll_project(view)
        assert(!pending(f.config.state_dir).some(item => item.job.project === "alpha"))
    } finally { f.cleanup() }
})

test("failed project CI keeps the existing working copy and static mirror on the approved commit", async () => {
    const f = fixture()
    try {
        const view = project_view(f.config, "alpha")
        await poll_project(view)
        await execute(f.config, pending(f.config.state_dir).find(item => item.job.project === "alpha")!.job)
        const remote = f.remotes.alpha
        writeFileSync(join(remote.work, "fail-ci"), "fail")
        git(remote.work, "add", "fail-ci")
        git(remote.work, "commit", "-q", "-m", "test: failed CI")
        git(remote.work, "push", "-q", remote.bare, "main")
        await poll_project(view)
        const result = await execute(f.config, pending(f.config.state_dir).find(item => item.job.project === "alpha")!.job)
        assert.equal(result.state, "failed")
        assert.equal(git(view.site.dir, "rev-parse", "HEAD"), remote.commit)
        assert(readFileSync(join(f.config.state_dir, "mirror/projects/alpha.git/info/refs"), "utf8").includes(remote.commit))
        assert(!result.steps.some(step => step.name === "deploy" || step.name === "upstream sync"))
    } finally { f.cleanup() }
})

test("runner reloads the project catalog and executes multiple independent project pipelines", { timeout: 60000 }, async () => {
    const f = fixture()
    let runner: ReturnType<typeof start_runner> | undefined
    try {
        runner = start_runner(f.config, { server_env: { DEPLOY_TOKEN: "test-secret" }, poll_ms: 10000 })
        const deadline = Date.now() + 45000
        while ((!list_runs(f.config.state_dir, "alpha", 1)[0]?.finished_at || !list_runs(f.config.state_dir, "beta", 1)[0]?.finished_at || runner.busy()) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20))
        assert.equal(list_runs(f.config.state_dir, "alpha", 1)[0]?.state, "passed")
        assert.equal(list_runs(f.config.state_dir, "beta", 1)[0]?.state, "passed")
        const file = join(f.engine, "content/projects.xml")
        writeFileSync(file, readFileSync(file, "utf8") + '<project id="local" name="Local" date="2026"><pipeline branch="trunk"/></project>')
        await runner.drain()
        assert.equal(f.config.projects.local.branch, "trunk")
        assert(existsSync(join(repository_path(f.config, "local"), "HEAD")))
    } finally { runner?.stop(); f.cleanup() }
})

test("translated server declarations must agree and operator archive/private overrides take precedence", async () => {
    const f = fixture()
    try {
        const file = join(f.engine, "content/projects.xml")
        const original = readFileSync(file, "utf8")
        writeFileSync(file, original + declaration("alpha", "release"))
        assert.throws(() => load_server_config(f.file), /Conflicting repo\/pipeline/)
        const diag = new_diagnostics()
        load_site(f.engine, await load_config(process.cwd()), diag, new Date("2026-01-01"))
        assert(diag.errors.some(error => error.includes("Conflicting repo/pipeline")), "CI content validation must catch catalog conflicts before updating the working copy")
        writeFileSync(file, original + declaration("alpha", "main"))
        const raw = JSON.parse(readFileSync(f.file, "utf8"))
        raw.projects.alpha = { active: false, visibility: "private", dir: "owner_checkout" }
        writeFileSync(f.file, JSON.stringify(raw))
        const config = load_server_config(f.file)
        assert.equal(is_active(config, "alpha"), false)
        assert.equal(config.projects.alpha.visibility, "private")
        assert.equal(config.projects.alpha.dir, join(f.root, "owner_checkout"))
    } finally { f.cleanup() }
})

test("declared npm commands run through an executable with their argument arrays intact", async () => {
    const f = fixture()
    try {
        const pipeline = f.config.projects.alpha.pipeline!
        pipeline.steps.unshift({ name: "npm version", phase: "ci", command: "npm", args: ["--version"], timeout_ms: 30000, credentials: [] })
        const literal = "a&b $(literal) quoted text"
        pipeline.steps.unshift({ name: "literal arguments", phase: "ci", command: "node", args: ["-e", "if (process.argv[1] !== 'a&b $(literal) quoted text') process.exit(1)", literal], timeout_ms: 30000, credentials: [] })
        await poll_project(project_view(f.config, "alpha"))
        const result = await execute(f.config, pending(f.config.state_dir).find(item => item.job.project === "alpha")!.job)
        assert.equal(result.state, "passed", result.message ?? "pipeline failed")
        assert(result.steps.some(step => step.name === "npm version" && step.ok))
        assert(result.steps.some(step => step.name === "literal arguments" && step.ok))
    } finally { f.cleanup() }
})

test("Worker discovers public project mirrors from the published catalog while the personal node is unavailable", async () => {
    const env = { DOMAIN: "example.com", PAGES_ORIGIN: "https://project-catalog.example.dev", PUBLIC_PROJECTS: "[]", PUBLIC_PROJECTS_MANIFEST: "/projects/git.json" }
    const seen: Request[] = []
    const upstream = async (request: Request) => {
        seen.push(request)
        assert.equal(request.headers.get("authorization"), null)
        assert.equal(request.headers.get("cookie"), null)
        return new URL(request.url).pathname === "/projects/git.json" ? Response.json(["alpha"]) : new Response("static Git data")
    }
    const response = await route(new Request("https://example.com/projects/alpha/info/refs?service=git-upload-pack", { headers: { authorization: "Basic private", cookie: "session=private" } }), env, upstream)
    assert.equal(response.status, 200)
    assert.equal(seen[0].url, "https://project-catalog.example.dev/projects/git.json")
    assert.equal(seen[1].url, "https://project-catalog.example.dev/projects/alpha.git/info/refs")
    assert.equal((await route(new Request("https://example.com/projects/alpha/HEAD"), env, upstream)).status, 200)
    assert.equal(seen.length, 3, "the catalog is cached between static Git reads")
    assert.equal((await route(new Request("https://example.com/projects/private/info/refs?service=git-upload-pack"), env, upstream)).status, 503)
    assert.equal(seen.length, 3, "undeclared private reads must not fall through to Pages")
})

test("archiving or removing a managed declaration never publishes its private review branches", async () => {
    const f = fixture()
    try {
        const view = project_view(f.config, "alpha")
        await poll_project(view)
        await execute(f.config, pending(f.config.state_dir).find(item => item.job.project === "alpha")!.job)
        git(view.site.dir, "checkout", "-q", "-b", "review")
        git(view.site.dir, "commit", "-q", "--allow-empty", "-m", "private review work")
        const review = git(view.site.dir, "rev-parse", "HEAD")
        git(view.site.dir, "push", "-q", repository_path(f.config, "alpha"), "review")
        const raw = JSON.parse(readFileSync(f.file, "utf8"))
        raw.projects.alpha = { active: false }
        writeFileSync(f.file, JSON.stringify(raw))
        const file = join(f.engine, "content/projects.xml")
        writeFileSync(file, readFileSync(file, "utf8").replace(declaration("alpha", "main"), ""))
        const archived = load_server_config(f.file)
        const result = refresh_mirrors(archived)
        assert.deepEqual(result.errors, [])
        const refs = readFileSync(join(f.config.state_dir, "mirror/projects/alpha.git/info/refs"), "utf8")
        assert(refs.includes(f.remotes.alpha.commit))
        assert(!refs.includes(review) && !refs.includes("refs/heads/review"))
    } finally { f.cleanup() }
})

test("an independent project's pipeline is not blocked by a broken unrelated archive", async () => {
    const f = fixture()
    try {
        const broken = join(f.root, "broken.git")
        mkdirSync(broken)
        writeFileSync(join(broken, "HEAD"), "not a git repository")
        f.config.projects.broken = { path: broken, visibility: "public" }
        await poll_project(project_view(f.config, "alpha"))
        const result = await execute(f.config, pending(f.config.state_dir).find(item => item.job.project === "alpha")!.job)
        assert.equal(result.state, "passed", result.message ?? "pipeline failed")
    } finally { f.cleanup() }
})
