/* Real Git branch integration: one deployment checkout, independent pipelines/state, protected production mirrors. */
import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { load_server_config, project_view, repository_path } from "../src/node/server_config.ts"
import { check_push, jobs_for_push, sync_repositories } from "../src/node/git_hooks.ts"
import { poll_project, read_sync_state } from "../src/node/repo_sync.ts"
import { claim, enqueue, finish, pending } from "../src/node/queue.ts"
import type { Job } from "../src/node/queue.ts"
import { run_pipeline } from "../src/node/pipeline.ts"
import type { Run_Record } from "../src/node/pipeline.ts"
import { plan_batch } from "../src/node/runner.ts"
import { parse_xml } from "../src/xml.ts"
import { validate_roots } from "../src/schema.ts"
import { new_diagnostics } from "../src/diag.ts"

function git(dir: string, ...args: string[]): string {
    return execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()
}

function fixture() {
    const root = mkdtempSync(join(tmpdir(), "jazu_staging_"))
    const engine = join(root, "engine")
    mkdirSync(join(engine, "content"), { recursive: true })
    const pipeline = (branch: string) => `<pipeline branch="${branch}" poll_seconds="10">${["ci", "build", "deploy"].map(phase => `<step name="${branch} ${phase}" phase="${phase}" command="node" args='["phase.mjs","${phase}","\${branch}","\${commit}"]'${phase === "deploy" ? ' credentials="DEPLOY_TOKEN"' : ""}/>`).join("")}</pipeline>`
    writeFileSync(join(engine, "content/projects.xml"), `<project id="sample" name="Sample" date="2026" repo="git.example/sample">${pipeline("master")}${pipeline("staging")}</project>`)
    git(engine, "init", "-qb", "master")
    git(engine, "add", ".")
    git(engine, "commit", "-qm", "catalog")
    const file = join(root, "server.json")
    writeFileSync(file, JSON.stringify({ repos_dir: "repos", state_dir: "state", site: { project: "engine", dir: "engine" } }))
    const config = load_server_config(file)
    sync_repositories(config)
    git(repository_path(config, "engine"), "fetch", "-q", engine, "master:master")
    const source = join(root, "source")
    mkdirSync(source)
    git(source, "init", "-qb", "master")
    writeFileSync(join(source, "phase.mjs"), `import fs from 'node:fs'; import assert from 'node:assert/strict'; const [phase,branch,commit]=process.argv.slice(2); if(phase!=='deploy') assert.equal(process.env.DEPLOY_TOKEN,undefined); if(phase==='ci' && fs.existsSync('fail-ci')) process.exit(1); if(phase==='build') fs.writeFileSync('built.json',JSON.stringify({branch,commit})); if(phase==='deploy') { assert.equal(process.env.DEPLOY_TOKEN,'secret'); assert.deepEqual(JSON.parse(fs.readFileSync('built.json','utf8')),{branch,commit}); fs.writeFileSync('deployed-'+branch+'.json',JSON.stringify({branch,commit,cwd:process.cwd()})); }`)
    writeFileSync(join(source, ".gitignore"), "built.json\ndeployed-*.json\n")
    writeFileSync(join(source, "version.txt"), "initial")
    git(source, "add", ".")
    git(source, "commit", "-qm", "initial")
    git(source, "branch", "staging")
    const remote = join(root, "remote.git")
    git(root, "clone", "--bare", "-q", source, remote)
    git(repository_path(config, "sample"), "config", `url.${remote.replace(/\\/g, "/")}.insteadOf`, "https://git.example/sample")
    const view = (branch: string) => project_view(config, "sample", branch)
    const update = (branch: string, fail = false) => {
        git(source, "switch", "-q", branch)
        writeFileSync(join(source, "version.txt"), `${branch}-${Date.now()}`)
        if (fail) writeFileSync(join(source, "fail-ci"), "fail")
        git(source, "add", ".")
        git(source, "commit", "-qm", "update")
        git(source, "push", "-q", remote, branch)
        return git(source, "rev-parse", "HEAD")
    }
    const execute = async (job: Job) => {
        assert(claim(config.state_dir, `${job.id}.json`))
        const record: Run_Record = { id: job.id, project: job.project, kind: job.kind, queued_at: job.queued_at, commit: job.commit, ref: job.ref, state: "queued", steps: [] }
        await run_pipeline(config, job, record, () => {}, () => {}, undefined, { DEPLOY_TOKEN: "secret" })
        finish(config.state_dir, `${job.id}.json`)
        return record
    }
    const run = async (branch: string) => {
        await poll_project(view(branch))
        const job = pending(config.state_dir).find(item => item.job.project === "sample" && item.job.ref === `refs/heads/${branch}`)!.job
        return execute(job)
    }
    return { root, source, remote, config, view, update, execute, run, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

test("distinct pipeline branches validate and every declared deployment ref is owner-only", () => {
    const f = fixture()
    try {
        const source = readFileSync(join(f.config.site.dir, "content/projects.xml"), "utf8")
        const diag = new_diagnostics()
        validate_roots(parse_xml(source, "projects.xml"), diag)
        assert.deepEqual(diag.errors, [])
        const duplicate = new_diagnostics()
        validate_roots(parse_xml(source.replace('branch="staging"', 'branch="master"'), "projects.xml"), duplicate)
        assert(duplicate.errors.some(error => error.includes("unique")))
        const updates = ["master", "staging", "review"].map(branch => ({ old: "0".repeat(40), new: "a".repeat(40), ref: `refs/heads/${branch}` }))
        assert.match(check_push(f.config, "sample", "write", [updates[1]])!, /only owners/)
        assert.equal(check_push(f.config, "sample", "write", [updates[2]]), null)
        assert.deepEqual(jobs_for_push(f.config, "sample", "owner", updates).map(job => job.ref), ["refs/heads/master", "refs/heads/staging"])
    } finally { f.cleanup() }
})

test("the same SHA on master and staging queues both pipelines and switches one shared deployment checkout", { timeout: 180000 }, async () => {
    const f = fixture()
    try {
        await poll_project(f.view("master"))
        await poll_project(f.view("staging"))
        const jobs = pending(f.config.state_dir).filter(item => item.job.project === "sample")
        assert.equal(jobs.length, 2)
        assert.equal(jobs[0].job.commit, jobs[1].job.commit)
        const batch = plan_batch(jobs)
        assert.equal(batch.run.length, 2)
        assert.equal(batch.superseded.length, 0)
        for (const item of jobs) assert.equal((await f.execute(item.job)).state, "passed")
        const master = f.view("master")
        const staging = f.view("staging")
        assert.equal(master.site.dir, staging.site.dir)
        assert.equal(git(staging.site.dir, "branch", "--show-current"), "staging")
        for (const branch of ["master", "staging"]) assert.equal(JSON.parse(readFileSync(join(master.site.dir, `deployed-${branch}.json`), "utf8")).branch, branch)
        assert(existsSync(join(master.state_dir, "last_green.json")))
        assert(existsSync(join(staging.state_dir, "last_green.json")))
        assert.equal(read_sync_state(master)?.commit, read_sync_state(staging)?.commit)
        await poll_project(master)
        await poll_project(staging)
        assert(!pending(f.config.state_dir).some(item => item.job.project === "sample"))
        const mirror = readFileSync(join(f.config.state_dir, "mirror/projects/sample.git/info/refs"), "utf8")
        assert(mirror.includes("refs/heads/master"))
        assert(!mirror.includes("refs/heads/staging"))
    } finally { f.cleanup() }
})

test("staging updates never republish production refs; master switches back only on its own update", { timeout: 180000 }, async () => {
    const f = fixture()
    try {
        assert.equal((await f.run("master")).state, "passed")
        const mirror = join(f.config.state_dir, "mirror/projects/sample.git/info/refs")
        const production = readFileSync(mirror, "utf8")
        const stage_commit = f.update("staging")
        assert.equal((await f.run("staging")).state, "passed")
        assert.equal(git(f.view("master").site.dir, "branch", "--show-current"), "staging")
        assert.equal(readFileSync(mirror, "utf8"), production)
        assert.equal(read_sync_state(f.view("staging"))?.commit, stage_commit)
        const working = f.view("staging").site.dir
        writeFileSync(join(working, "version.txt"), "committed staging edit on the personal server")
        git(working, "add", "version.txt")
        git(working, "commit", "-qm", "local staging change")
        const local_stage = git(working, "rev-parse", "HEAD")
        assert.equal((await f.run("staging")).state, "passed")
        assert.equal(git(f.remote, "rev-parse", "staging"), local_stage)
        assert.equal(readFileSync(mirror, "utf8"), production)
        await poll_project(f.view("master"))
        assert(!pending(f.config.state_dir).some(item => item.job.project === "sample"))
        const deferred = enqueue(f.config.state_dir, { kind: "site_changed", project: "sample", ref: "refs/heads/master" })
        assert.equal((await f.execute(deferred)).state, "superseded")
        assert.equal(git(f.view("master").site.dir, "branch", "--show-current"), "staging")
        const master_commit = f.update("master")
        assert.equal((await f.run("master")).state, "passed")
        assert.equal(git(f.view("master").site.dir, "branch", "--show-current"), "master")
        assert.equal(git(f.view("master").site.dir, "rev-parse", "HEAD"), master_commit)
        assert(readFileSync(mirror, "utf8").includes(master_commit))
        assert(!readFileSync(mirror, "utf8").includes(stage_commit))
    } finally { f.cleanup() }
})

test("failed staging CI and dirty deployment files cannot overwrite the approved working copy", { timeout: 180000 }, async () => {
    const f = fixture()
    try {
        assert.equal((await f.run("master")).state, "passed")
        const dir = f.view("master").site.dir
        const approved = git(dir, "rev-parse", "HEAD")
        f.update("staging", true)
        assert.equal((await f.run("staging")).state, "failed")
        assert.equal(git(dir, "rev-parse", "HEAD"), approved)
        assert.equal(git(dir, "branch", "--show-current"), "master")
        git(f.source, "rm", "fail-ci")
        git(f.source, "commit", "-qm", "fix staging")
        git(f.source, "push", "-q", f.remote, "staging")
        writeFileSync(join(dir, "version.txt"), "uncommitted owner work")
        const result = await f.run("staging")
        assert.equal(result.state, "failed")
        assert.match(result.message!, /uncommitted/)
        assert.equal(readFileSync(join(dir, "version.txt"), "utf8"), "uncommitted owner work")
        assert.equal(git(dir, "branch", "--show-current"), "master")
    } finally { f.cleanup() }
})

test("a declared upstream branch may be absent until created without producing a sync error", { timeout: 180000 }, async () => {
    const f = fixture()
    try {
        git(f.remote, "branch", "-D", "staging")
        const missing = await poll_project(f.view("staging"))
        assert.equal(missing?.status, "unchanged")
        assert(!pending(f.config.state_dir).some(item => item.job.project === "sample"))
        git(f.source, "push", "-q", f.remote, "staging")
        assert.equal((await poll_project(f.view("staging")))?.status, "imported")
    } finally { f.cleanup() }
})
