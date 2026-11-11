/*
 * CI/CD of the `jazu` project: the single pipeline of the personal server. Read it top to bottom; it is meant to be
 * the template to copy when another project gets its own pipeline.
 *
 *   push to the deploy branch
 *     CI  clean checkout of that exact commit -> install deps if package-lock changed -> types -> tests -> content check
 *         any failure stops here: the commit is never deployed and the working copy never advances
 *     CD  refresh the static git mirror -> fast-forward the server's working copy to the vetted commit
 *         -> `node src/main.ts publish` (build, compare with the last deploy, `wrangler pages deploy` only if different)
 *   file change in the working copy (site_changed)
 *     CD only: there is no commit to vet, so it builds and publishes what is on disk
 *
 * Entities:
 *   Pipeline_Steps / jazu_steps   the commands, as data, so a test (or another project) can swap them
 *   Run_Record                    what is stored per run and shown by `GET /ci/jazu/runs` (public view drops private fields)
 *   run_pipeline(...)             executes one job and fills the record; throws nothing the runner cannot report
 *
 * Scope:
 *   Commands run with a scrubbed environment (PATH, HOME inside the state dir, CI=true). Only the publish step also
 *   receives the Cloudflare credentials. Pushers are owners by policy (git_hooks.ts), because `npm test` and the build
 *   execute the pushed code on this machine. Never touches Terraform or the Worker: infrastructure stays `npm run deploy`.
 */
import { spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { Job } from "./queue.ts"
import { mirror_dir, refresh_mirrors } from "./git_mirror.ts"
import type { Mirror_Result } from "./git_mirror.ts"
import { repository_path } from "./server_config.ts"
import type { Server_Config } from "./server_config.ts"

export type Step_Command = { name: string, command: string, args: string[], timeout_ms?: number }
export type Pipeline_Steps = { install: Step_Command, ci: Step_Command[], publish: Step_Command }
export type Step_Result = { name: string, ok: boolean, code: number | null, ms: number }
export type Run_State = "queued" | "running" | "passed" | "failed" | "superseded"
export type Run_Record = {
    id: string, kind: Job["kind"], project: string, state: Run_State, queued_at: number
    commit?: string, ref?: string, pusher?: string, started_at?: number, finished_at?: number
    steps: Step_Result[], deployed?: boolean, message?: string, mirrors?: Mirror_Result[]
}
export type Log = (text: string) => void
type Command_Output = { result: Step_Result, tail: string }

const npm = process.platform === "win32" ? "npm.cmd" : "npm"
const minutes = (count: number) => count * 60_000

export const jazu_steps: Pipeline_Steps = {
    install: { name: "install dependencies", command: npm, args: ["ci", "--no-audit", "--no-fund"], timeout_ms: minutes(15) },
    ci: [
        { name: "types", command: npm, args: ["run", "types"], timeout_ms: minutes(10) },
        { name: "tests", command: npm, args: ["test"], timeout_ms: minutes(15) },
        { name: "content check", command: npm, args: ["run", "check"], timeout_ms: minutes(10) },
    ],
    publish: { name: "publish", command: process.execPath, args: ["src/main.ts", "publish"], timeout_ms: minutes(20) },
}

function child_environment(config: Server_Config, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
    const home = join(config.state_dir, "home")
    mkdirSync(home, { recursive: true })
    const kept: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: home, CI: "true" }
    for (const name of ["SystemRoot", "ComSpec", "PATHEXT", "TEMP", "TMP", "LANG", "LC_ALL"]) if (process.env[name]) kept[name] = process.env[name]
    return { ...kept, ...extra }
}

function run_command(step: Step_Command, cwd: string, env: NodeJS.ProcessEnv, log: Log, extra_args: string[] = []): Promise<Command_Output> {
    return new Promise(resolve_output => {
        const started = Date.now()
        log(`\n$ ${step.command} ${[...step.args, ...extra_args].join(" ")}   (${cwd})\n`)
        const child = spawn(step.command, [...step.args, ...extra_args], { cwd, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, shell: step.command.endsWith(".cmd") })
        let tail = ""
        const timer = setTimeout(() => { log(`\n[timeout after ${step.timeout_ms}ms]\n`); child.kill("SIGKILL") }, step.timeout_ms ?? minutes(10))
        const forward = (chunk: Buffer) => { const text = chunk.toString("utf8"); log(text); tail = (tail + text).slice(-20_000) }
        child.stdout.on("data", forward)
        child.stderr.on("data", forward)
        const done = (code: number | null, note?: string) => {
            clearTimeout(timer)
            if (note) log(`\n[${note}]\n`)
            resolve_output({ result: { name: step.name, ok: code === 0, code, ms: Date.now() - started }, tail })
        }
        child.on("error", error => done(null, `could not start: ${error.message}`))
        child.on("close", code => done(code))
    })
}

function git(args: string[], cwd: string, env: NodeJS.ProcessEnv, log: Log): { code: number | null, stdout: string } {
    const result = spawnSync("git", args, { cwd, env, encoding: "utf8", windowsHide: true })
    log(`\n$ git ${args.join(" ")}   (${cwd})\n${result.stdout ?? ""}${result.stderr ?? ""}`)
    return { code: result.status, stdout: (result.stdout ?? "").trim() }
}

function git_must(args: string[], cwd: string, env: NodeJS.ProcessEnv, log: Log, why: string): string {
    const result = git(args, cwd, env, log)
    if (result.code !== 0) throw new Error(`${why} (git ${args[0]} exited ${result.code})`)
    return result.stdout
}

// `npm ci` is slow, so it runs only when package-lock.json differs from the one the installed node_modules came from.
async function ensure_dependencies(dir: string, steps: Pipeline_Steps, env: NodeJS.ProcessEnv, log: Log, record: Run_Record): Promise<boolean> {
    const lock = join(dir, "package-lock.json")
    if (!existsSync(lock)) return true
    const hash = createHash("sha256").update(readFileSync(lock)).digest("hex")
    const marker = join(dir, "node_modules", ".jazu_lock")
    if (existsSync(marker) && readFileSync(marker, "utf8") === hash) return true
    const { result } = await run_command(steps.install, dir, env, log)
    record.steps.push(result)
    if (!result.ok) return false
    mkdirSync(join(dir, "node_modules"), { recursive: true })
    writeFileSync(marker, hash)
    return true
}

// A separate clone per project keeps CI from touching the working copy: that only advances after everything passed.
function checkout_for_ci(config: Server_Config, commit: string, env: NodeJS.ProcessEnv, log: Log): string {
    const dir = join(config.state_dir, "ci", config.site.project)
    if (!existsSync(join(dir, ".git"))) {
        mkdirSync(dir, { recursive: true })
        git_must(["clone", "--no-checkout", "--quiet", repository_path(config, config.site.project), dir], config.state_dir, env, log, "cannot clone the repository for CI")
    }
    git_must(["fetch", "--quiet", "origin", "+refs/heads/*:refs/remotes/origin/*"], dir, env, log, "cannot fetch the repository for CI")
    git_must(["cat-file", "-e", `${commit}^{commit}`], dir, env, log, `commit ${commit} is not in the repository`)
    git_must(["checkout", "--quiet", "--force", "--detach", commit], dir, env, log, "cannot check out the commit")
    git(["clean", "-fdxq", "-e", "node_modules"], dir, env, log)
    return dir
}

// Fast-forward only, never reset: uncommitted edits made directly on the server are never destroyed.
function advance_working_copy(config: Server_Config, commit: string, env: NodeJS.ProcessEnv, log: Log): void {
    const dir = config.site.dir
    if (!existsSync(join(dir, ".git"))) throw new Error(`${dir} is not a git working copy; set site.dir in server.json`)
    const branch = git_must(["symbolic-ref", "--short", "-q", "HEAD"], dir, env, log, "working copy has a detached HEAD")
    if (branch !== config.site.branch) throw new Error(`working copy is on ${branch}, expected ${config.site.branch}`)
    if (git_must(["status", "--porcelain", "--untracked-files=no"], dir, env, log, "cannot read working copy status")) throw new Error("working copy has uncommitted changes; commit or discard them, then run `server run`")
    if (git(["merge-base", "--is-ancestor", commit, "HEAD"], dir, env, log).code === 0) return
    const tracking = `refs/remotes/jazu-hub/${config.site.branch}`
    git_must(["fetch", "--quiet", repository_path(config, config.site.project), `+refs/heads/${config.site.branch}:${tracking}`], dir, env, log, "cannot fetch into the working copy")
    git_must(["merge", "--ff-only", "--quiet", commit], dir, env, log, "working copy has diverged from the repository and cannot fast-forward")
}

function last_green_file(config: Server_Config): string { return join(config.state_dir, "last_green.json") }

function read_last_green(config: Server_Config): string | undefined {
    try { return JSON.parse(readFileSync(last_green_file(config), "utf8")).commit } catch { return undefined }
}

async function run_ci(config: Server_Config, commit: string, steps: Pipeline_Steps, log: Log, record: Run_Record): Promise<boolean> {
    const env = child_environment(config)
    const dir = checkout_for_ci(config, commit, env, log)
    if (!await ensure_dependencies(dir, steps, env, log, record)) return false
    for (const step of steps.ci) {
        const { result } = await run_command(step, dir, env, log)
        record.steps.push(result)
        if (!result.ok) return false
    }
    writeFileSync(last_green_file(config), JSON.stringify({ commit, at: new Date().toISOString() }))
    return true
}

async function run_cd(config: Server_Config, job: Job, steps: Pipeline_Steps, server_env: NodeJS.ProcessEnv, log: Log, record: Run_Record): Promise<void> {
    const env = child_environment(config)
    const commit = job.commit
    const mirrors = refresh_mirrors(config, commit ?? read_last_green(config))
    record.mirrors = mirrors.results
    for (const error of mirrors.errors) log(`\n[mirror] ${error}\n`)
    if (commit) advance_working_copy(config, commit, env, log)
    if (!await ensure_dependencies(config.site.dir, steps, env, log, record)) throw new Error("dependency install failed in the working copy")
    const head = git(["log", "-1", "--format=%H%x09%s"], config.site.dir, env, log).stdout.split("\t")
    const publish_env = child_environment(config, { CLOUDFLARE_API_TOKEN: server_env.CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID: server_env.CLOUDFLARE_ACCOUNT_ID, WRANGLER_SEND_METRICS: "false" })
    const flags = ["--overlay", mirror_dir(config), "--state_file", join(config.state_dir, "published.json"), "--commit", head[0] ?? "", "--message", head[1] ?? "site files changed"]
    const { result, tail } = await run_command(steps.publish, config.site.dir, publish_env, log, flags)
    record.steps.push(result)
    if (!result.ok) throw new Error("publish failed")
    const line = tail.split("\n").reverse().find(text => text.startsWith("JAZU_PUBLISH "))
    const outcome = line ? JSON.parse(line.slice("JAZU_PUBLISH ".length)) : { deployed: false, reason: "unknown" }
    record.deployed = Boolean(outcome.deployed)
    record.message = outcome.deployed ? "deployed to Cloudflare Pages" : `nothing to deploy (${outcome.reason})`
}

export async function run_pipeline(config: Server_Config, job: Job, record: Run_Record, log: Log, save: () => void, steps: Pipeline_Steps = jazu_steps, server_env: NodeJS.ProcessEnv = process.env): Promise<void> {
    record.state = "running"
    record.started_at = Date.now()
    save()
    try {
        if (job.kind !== "site_changed") {
            if (!job.commit) throw new Error("job has no commit")
            if (!await run_ci(config, job.commit, steps, log, record)) {
                record.state = "failed"
                record.message = `CI failed at "${record.steps.at(-1)?.name}"; the commit was not deployed`
                return
            }
        }
        await run_cd(config, job, steps, server_env, log, record)
        record.state = "passed"
    } catch (error) {
        record.state = "failed"
        record.message = error instanceof Error ? error.message : String(error)
        log(`\n[error] ${record.message}\n`)
    } finally {
        record.finished_at = Date.now()
        save()
    }
}
