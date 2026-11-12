/*
 * Process boundary between the durable listener and replaceable engine code.
 * Engine jobs stage their exact Git commit before loading its catalog or pipeline implementation.
 * Workers exchange private JSON over stdin and durable records; stdout/stderr are bounded by the run log.
 * Failed workers cannot terminate the listener or prevent it from importing a corrective commit.
 */
import { execFile, execFileSync, spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { Server_Config } from "./server_config.ts"
import { repository_path, project_branches } from "./server_config.ts"
import { child_environment, run_command } from "./pipeline_process.ts"
import type { Log, Run_Record } from "./pipeline.ts"
import type { Job } from "./queue.ts"

function git(cwd: string, args: string[], log: Log): Promise<void> {
    return new Promise((resolve, reject) => execFile("git", args, { cwd, windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
        log(`${stdout}${stderr}`)
        if (error) reject(new Error(`runtime git ${args[0]} failed: ${error.message}`))
        else resolve()
    }))
}

export function listener_fingerprint(dir: string): string {
    const hash = createHash("sha256")
    const visit = (path: string): void => {
        if (!existsSync(path)) return
        for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            const file = join(path, entry.name)
            if (entry.isDirectory()) visit(file)
            else if (entry.isFile()) hash.update(file.slice(dir.length)).update(readFileSync(file))
        }
    }
    visit(join(dir, "src"))
    for (const file of ["package.json", "package-lock.json", "tsconfig.json"]) if (existsSync(join(dir, file))) hash.update(file).update(readFileSync(join(dir, file)))
    return hash.digest("hex")
}

export function listener_updated(dir: string, fingerprint: string): boolean {
    if (listener_fingerprint(dir) === fingerprint) return false
    // Do not restart halfway through an operator's uncommitted source edits.
    return execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: dir, encoding: "utf8", windowsHide: true }).trim() === ""
}

async function stage_engine(config: Server_Config, commit: string, log: Log): Promise<string> {
    if (!/^[a-f0-9]{40,64}$/.test(commit)) throw new Error("Invalid engine commit")
    const dir = join(config.state_dir, "runtime")
    mkdirSync(config.state_dir, { recursive: true })
    if (!existsSync(join(dir, ".git"))) await git(config.state_dir, ["clone", "--shared", "--no-checkout", "--quiet", repository_path(config, config.site.project), dir], log)
    await git(dir, ["fetch", "--quiet", "origin", "+refs/heads/*:refs/remotes/origin/*"], log)
    await git(dir, ["checkout", "--force", "--detach", commit], log)
    await git(dir, ["clean", "-fdxq", "-e", "node_modules"], log)
    if (!existsSync(join(dir, "src/node/job_main.ts"))) throw new Error("Incoming engine has no job worker; automatic runtime protocol migration requires operator intervention")
    const lock = join(dir, "package-lock.json")
    if (existsSync(lock)) {
        const hash = createHash("sha256").update(readFileSync(lock)).digest("hex")
        const marker = join(dir, "node_modules/.jazu_runtime_lock")
        if (!existsSync(marker) || readFileSync(marker, "utf8") !== hash) {
            const output = await run_command({ name: "Runtime dependencies", command: "npm", args: ["ci", "--no-audit", "--no-fund"], timeout_ms: 600000 }, dir, child_environment(config), log)
            if (!output.result.ok) throw new Error("Cannot install incoming engine runtime dependencies")
            writeFileSync(marker, hash)
        }
    }
    return dir
}

function worker(dir: string, mode: string, payload: unknown, env: NodeJS.ProcessEnv, log: Log): Promise<string> {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [join(dir, "src/node/job_main.ts"), mode], { cwd: dir, env, windowsHide: true, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"] })
        child.stdout.setEncoding("utf8")
        child.stderr.setEncoding("utf8")
        let output = ""
        let error_tail = ""
        // Each command has its own timeout; the outer bound also covers hung worker orchestration.
        const kill_tree = () => {
            try {
                if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL")
                else child.kill("SIGKILL")
            } catch { /* The process group has already exited. */ }
        }
        const timer = setTimeout(kill_tree, mode === "run" ? 6 * 60 * 60 * 1000 : 30000)
        child.stdout.on("data", chunk => {
            if (mode !== "run") output = (output + chunk).slice(-4 * 1024 * 1024)
            else log(chunk.toString())
        })
        child.stderr.on("data", chunk => { error_tail = (error_tail + chunk).slice(-4000); log(chunk.toString()) })
        child.stdin.on("error", () => {})
        child.on("error", error => { clearTimeout(timer); reject(error) })
        // Descendants can keep stdout open after a worker crashes; terminate them on exit, before close.
        child.on("exit", kill_tree)
        child.on("close", code => {
            clearTimeout(timer)
            kill_tree()
            if (code === 0) resolve(output)
            else reject(new Error(`Engine worker exited ${code}: ${error_tail}`))
        })
        child.stdin.end(JSON.stringify(payload))
    })
}

export async function fresh_catalog(config: Server_Config): Promise<Server_Config> {
    const output = await worker(config.site.dir, "catalog", { file: config.file, legacy: JSON.parse(process.env.JAZU_REPOSITORIES_JSON ?? "{}") }, child_environment(config), () => {})
    return JSON.parse(output)
}

export async function run_job_process(config: Server_Config, job: Job, record: Run_Record, log: Log, server_env: NodeJS.ProcessEnv): Promise<void> {
    const dir = job.project === config.site.project && job.commit ? await stage_engine(config, job.commit, log) : config.site.dir
    const env = { ...child_environment(config), HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK, JAZU_REPOSITORIES_JSON: process.env.JAZU_REPOSITORIES_JSON, ...server_env }
    if (project_branches(config, job.project).length > 1) {
        const capabilities = JSON.parse(await worker(dir, "capabilities", {}, child_environment(config), log))
        if (capabilities.branch_pipelines !== true) throw new Error("Engine worker lacks branch pipeline support; merge the staging feature into this branch before deploying it")
    }
    await worker(dir, "run", { config, job, record, catalog_dir: dir }, env, log)
    Object.assign(record, JSON.parse(readFileSync(join(config.state_dir, "runs", `${job.id}.json`), "utf8")))
}
