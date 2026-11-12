/*
 * Generic per-project CI/CD executor. Project XML supplies ci/build/deploy commands; server config supplies paths.
 * CI uses a clean exact-commit checkout, then the tested commit advances the working copy and upstream.
 * Build steps run without server secrets; deploy steps receive only their explicitly requested credentials.
 * Public mirrors share the engine's Pages/R2 overlay. Jobs and logs remain in the common durable queue.
 */
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import type { Job } from "./queue.ts"
import { mirror_dir, refresh_mirror, refresh_mirrors } from "./git_mirror.ts"
import type { Mirror_Result } from "./git_mirror.ts"
import { is_public, project_view, queue_root, repository_path } from "./server_config.ts"
import { enqueue } from "./queue.ts"
import type { Server_Config } from "./server_config.ts"
import { push_upstream } from "./repo_sync.ts"
import { child_environment, run_command } from "./pipeline_process.ts"

export type Step_Command = { name: string, command: string, args: string[], timeout_ms?: number, credentials?: string[] }
export type Pipeline_Steps = { install?: Step_Command, ci: Step_Command[], build?: Step_Command[], deploy?: Step_Command[], publish?: Step_Command }
export type Step_Result = { name: string, ok: boolean, code: number | null, ms: number }
export type Run_State = "queued" | "running" | "passed" | "failed" | "superseded"
export type Run_Record = {
    id: string, kind: Job["kind"], project: string, state: Run_State, queued_at: number
    commit?: string, ref?: string, pusher?: string, started_at?: number, finished_at?: number
    steps: Step_Result[], deployed?: boolean, message?: string, mirrors?: Mirror_Result[]
}
export type Log = (text: string) => void
export function project_steps(config: Server_Config): Pipeline_Steps {
    const steps = config.pipeline?.steps ?? []
    return { ci: steps.filter(step => step.phase === "ci"), build: steps.filter(step => step.phase === "build"), deploy: steps.filter(step => step.phase === "deploy") }
}

function expand_command(step: Step_Command, config: Server_Config, commit: string): Step_Command {
    const variables: Record<string, string> = { project: config.site.project, branch: config.site.branch, commit, mirror_dir: mirror_dir(config), publish_state: join(config.state_dir, "published.json") }
    return { ...step, args: step.args.map(arg => arg.replace(/\$\{([^}]+)\}/g, (_match, name) => {
        if (!(name in variables)) throw new Error(`Unknown pipeline variable ${name}`)
        return variables[name]
    })) }
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
    if (!steps.install) return true
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
    // Build artifacts and the public media archive are operator-provided and ignored by Git.
    // Restore them after clean so a fresh CI clone has the same build inputs as the deployment checkout.
    for (const entry of ["build", "content/media"]) {
        const source = join(config.site.dir, entry)
        if (existsSync(source)) cpSync(source, join(dir, entry), { recursive: true, force: false, filter: file => file !== join(source, "build.zip") })
    }
    return dir
}

// Fast-forward only, never reset: uncommitted edits made directly on the server are never destroyed.
function advance_working_copy(config: Server_Config, commit: string, env: NodeJS.ProcessEnv, log: Log): void {
    const dir = config.site.dir
    if (!existsSync(join(dir, ".git"))) {
        if (existsSync(dir) && readdirSync(dir).length) throw new Error(`${dir} is not an empty directory or Git checkout; configure the project working directory`)
        mkdirSync(dirname(dir), { recursive: true })
        git_must(["clone", "--no-checkout", "--quiet", repository_path(config, config.site.project), dir], config.state_dir, env, log, "cannot create the working checkout")
        git_must(["checkout", "--quiet", "-B", config.site.checkout_branch ?? config.site.branch, commit], dir, env, log, "cannot initialize the working checkout at the tested commit")
    }
    const branch = git_must(["symbolic-ref", "--short", "-q", "HEAD"], dir, env, log, "working copy has a detached HEAD")
    if (branch !== (config.site.checkout_branch ?? config.site.branch)) throw new Error(`working copy is on ${branch}, expected ${config.site.checkout_branch ?? config.site.branch}`)
    if (git_must(["status", "--porcelain", "--untracked-files=no"], dir, env, log, "cannot read working copy status")) throw new Error("working copy has uncommitted changes; commit or discard them, then run `server run`")
    const tracking = `refs/remotes/jazu-hub/${config.site.branch}`
    git_must(["fetch", "--quiet", repository_path(config, config.site.project), `+refs/heads/${config.site.branch}:${tracking}`], dir, env, log, "cannot fetch into the working copy")
    const head = git_must(["rev-parse", "HEAD"], dir, env, log, "cannot read working copy commit")
    if (head === commit) return
    if (git(["merge-base", "--is-ancestor", commit, "HEAD"], dir, env, log).code === 0) throw new Error("working copy is ahead of the tested commit; synchronize the hub and queue its current tip before publishing")
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
        const { result } = await run_command(expand_command(step, config, commit), dir, env, log)
        record.steps.push(result)
        if (!result.ok) return false
    }
    writeFileSync(last_green_file(config), JSON.stringify({ commit, at: new Date().toISOString() }))
    return true
}

async function run_cd(config: Server_Config, job: Job, steps: Pipeline_Steps, server_env: NodeJS.ProcessEnv, log: Log, record: Run_Record): Promise<void> {
    const env = child_environment(config)
    const commit = job.commit
    if (commit) advance_working_copy(config, commit, env, log)
    if (commit && config.upstream) {
        const started = Date.now()
        log("\n[upstream] synchronizing the tested commit\n")
        try {
            await push_upstream(config, commit)
            log("[upstream] tested commit synchronized\n")
            record.steps.push({ name: "upstream sync", ok: true, code: 0, ms: Date.now() - started })
        } catch (error) {
            record.steps.push({ name: "upstream sync", ok: false, code: 1, ms: Date.now() - started })
            throw error
        }
    }
    const approved = commit ?? read_last_green(config)
    const root = config.root_config ?? config
    const mirrors = config.site.project === root.site.project
        ? refresh_mirrors(config, approved ? { [config.site.project]: approved } : undefined)
        : { results: [refresh_mirror(root, config.site.project, approved)], errors: [] }
    record.mirrors = mirrors.results
    if (mirrors.errors.length) throw new Error(`static Git mirror failed: ${mirrors.errors.join("; ")}`)
    if (!await ensure_dependencies(config.site.dir, steps, env, log, record)) throw new Error("dependency install failed in the working copy")
    const head = git(["log", "-1", "--format=%H%x09%s"], config.site.dir, env, log).stdout.split("\t")
    for (const step of steps.build ?? []) {
        const { result } = await run_command(expand_command(step, config, head[0] ?? ""), config.site.dir, env, log)
        record.steps.push(result)
        if (!result.ok) throw new Error(`build failed at "${step.name}"`)
    }
    let outcome: { deployed: boolean, reason: string } | undefined
    const deployments = steps.publish ? [steps.publish] : steps.deploy ?? []
    for (const step of deployments) {
        const names = step.credentials ?? (steps.publish ? ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"] : [])
        const credentials = Object.fromEntries(names.filter(name => server_env[name] !== undefined).map(name => [name, server_env[name]]))
        const publish_env = child_environment(config, { ...credentials, WRANGLER_SEND_METRICS: "false" })
        const flags = steps.publish ? ["--overlay", mirror_dir(config), "--state_file", join(config.state_dir, "published.json"), "--commit", head[0] ?? "", "--message", head[1] ?? "site files changed"] : []
        const { result, tail } = await run_command(expand_command(step, config, head[0] ?? ""), config.site.dir, publish_env, log, flags)
        record.steps.push(result)
        if (!result.ok) throw new Error(`publish failed at "${step.name}"`)
        const line = tail.split("\n").reverse().find(text => text.startsWith("JAZU_PUBLISH "))
        if (line) outcome = JSON.parse(line.slice("JAZU_PUBLISH ".length))
    }
    record.deployed = outcome?.deployed ?? deployments.length > 0
    record.message = outcome && !outcome.deployed ? `nothing to deploy (${outcome.reason})` : deployments.length ? "deployment completed" : "repository synchronized; no deployment steps"
    if (config.site.project !== root.site.project && is_public(root, config.site.project)) enqueue(queue_root(config), { kind: "site_changed", project: root.site.project })

}

export async function run_pipeline(config: Server_Config, job: Job, record: Run_Record, log: Log, save: () => void, steps?: Pipeline_Steps, server_env: NodeJS.ProcessEnv = process.env): Promise<void> {
    record.state = "running"
    record.started_at = Date.now()
    save()
    try {
        config = project_view(config, job.project)
        mkdirSync(config.state_dir, { recursive: true })
        steps ??= project_steps(config)
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
