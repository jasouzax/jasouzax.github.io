/* Hook integration uses real Git refs and a durable queue in an isolated temporary checkout. */
import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pipeline_hook } from "../../../server/pipeline/hook.ts"
import { pending } from "../../../server/pipeline/queue.ts"
import { parse_pipeline } from "../../../shared/content/pipeline.ts"
import { parse_xml } from "../../../shared/content/xml.ts"
import type { Server_Config } from "../../../server/config/repositories.ts"
import { personal_server } from "../../../server/repo/index.ts"
import { sign_origin } from "../../../shared/sign.ts"
import { once } from "node:events"

test("named hooks queue exact tips for declared branches and reject unknown hooks", async () => {
    const root = mkdtempSync(join(tmpdir(), "jazu-hook-")), repo = join(root, "repos", "example.git")
    const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim()
    try {
        git("init", "--bare", "-b", "master", repo)
        const tree = git("--git-dir", repo, "hash-object", "-t", "tree", "--stdin")
        const commit = git("--git-dir", repo, "commit-tree", tree, "-m", "fixture")
        git("--git-dir", repo, "update-ref", "refs/heads/master", commit)
        const pipeline = parse_pipeline(parse_xml('<pipeline hook="publish" branch="master"><step name="check"/></pipeline>', "hook.xml")[0])
        const config = { repos_dir: join(root, "repos"), state_dir: join(root, "state"), site: { project: "example", branch: "master", dir: root }, projects: {}, pipeline, pipelines: { master: pipeline } } as unknown as Server_Config
        assert.equal(pipeline_hook("/projects/example/missing", config).status, 404)
        const response = pipeline_hook("/projects/example/publish", config)
        assert.equal(response.status, 202)
        const jobs = pending(config.state_dir)
        assert.equal(jobs.length, 1)
        assert.equal(jobs[0].job.commit, commit)
        assert.equal(jobs[0].job.kind, "hook")
        assert.equal(jobs[0].job.ref, "refs/heads/master")
        assert.throws(() => parse_pipeline(parse_xml('<pipeline hook="../bad"/>', "hook.xml")[0]), /hook/)
        const secret = "synthetic-origin-secret-at-least-32-characters"
        const server = personal_server({ port: 0, secret, repositories: {}, config })
        try {
            await once(server, "listening")
            const url = `http://127.0.0.1:${(server.address() as any).port}/projects/example/publish`
            assert.equal((await fetch(url, { method: "POST" })).status, 401)
            const headers = await sign_origin(new Request(url, { method: "POST" }), secret, "pipeline")
            assert.equal((await fetch(url, { method: "POST", headers })).status, 202)
            assert.equal((await fetch(url, { method: "POST", headers })).status, 401)
            assert.equal(pending(config.state_dir).length, 2)
        } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
    } finally { rmSync(root, { recursive: true, force: true }) }
})
