/*
 * Bidirectional synchronization of the public deploy branch with an operator-configured upstream repository.
 *   poll_upstream: fetch into a private ref, fast-forward the hub atomically, and enqueue ordinary CI/CD.
 *   push_upstream: publish only the exact commit whose CI passed; ordinary Git push protects concurrent writers.
 *   read_sync_state: private operator status, including errors and a durable import intent for restart recovery.
 * Only the configured branch is synchronized. Never force-push, merge divergent histories, or copy secrets/hooks.
 * Git network commands use the server user's SSH/credential configuration, independently of the scrubbed CI HOME.
 */
import { execFile } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { enqueue } from "./queue.ts"
import { repository_path, queue_root, zero_oid } from "./server_config.ts"
import type { Server_Config } from "./server_config.ts"

export type Sync_State = {
    status: "unchanged" | "imported" | "ahead" | "pushed" | "error"
    checked_at: number
    commit?: string
    observed_commit?: string
    pending_commit?: string
    pending_source?: "upstream" | "checkout"
    message?: string
}

const tracking_ref = "refs/jazu-sync/upstream"
const state_file = (config: Server_Config) => join(config.state_dir, "upstream.json")

export function read_sync_state(config: Server_Config): Sync_State | undefined {
    try { return JSON.parse(readFileSync(state_file(config), "utf8")) } catch { return undefined }
}

function save_state(config: Server_Config, state: Sync_State): void {
    mkdirSync(config.state_dir, { recursive: true })
    const temp = `${state_file(config)}.${process.pid}.tmp`
    writeFileSync(temp, JSON.stringify(state, null, 4) + "\n", { mode: 0o600 })
    renameSync(temp, state_file(config))
}

// The fixed environment prevents CGI Git variables or Cloudflare credentials from leaking into SSH/helpers.
function network_environment(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: process.env.HOME ?? homedir(), GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "Never", GIT_SSH_COMMAND: "ssh -o BatchMode=yes -o ConnectTimeout=10" }
    for (const key of ["USERPROFILE", "SSH_AUTH_SOCK", "SystemRoot", "ComSpec", "PATHEXT", "TEMP", "TMP", "LANG", "LC_ALL"]) if (process.env[key]) env[key] = process.env[key]
    return env
}

function git(config: Server_Config, args: string[]): Promise<{ code: number, text: string }> {
    return new Promise(resolve => execFile("git", ["-C", repository_path(config, config.site.project), ...args], { env: network_environment(), timeout: 60_000, maxBuffer: 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
        resolve({ code: error ? (typeof error.code === "number" ? error.code : -1) : 0, text: `${stdout}${stderr}`.trim() || error?.message || "" })
    }))
}

async function must_git(config: Server_Config, args: string[], message: string): Promise<string> {
    const result = await git(config, args)
    if (result.code !== 0) throw new Error(`${message}: ${result.text.slice(-600)}`)
    return result.text
}

export async function hub_tip(config: Server_Config): Promise<string> {
    const exists = await git(config, ["show-ref", "--verify", "--quiet", `refs/heads/${config.site.branch}`])
    if (exists.code === 1) return zero_oid
    return must_git(config, ["rev-parse", `refs/heads/${config.site.branch}^{commit}`], "Cannot read hub deploy branch")
}

async function ancestor(config: Server_Config, older: string, newer: string): Promise<boolean> {
    if (older === zero_oid) return true
    const result = await git(config, ["merge-base", "--is-ancestor", older, newer])
    if (result.code > 1 || result.code < 0) throw new Error(`Cannot compare repository histories: ${result.text.slice(-300)}`)
    return result.code === 0
}

async function fetch_upstream(config: Server_Config): Promise<string> {
    const upstream = config.upstream!
    await must_git(config, ["fetch", "--quiet", "--no-tags", "--no-write-fetch-head", upstream.remote, `+refs/heads/${upstream.branch}:${tracking_ref}`], "Cannot fetch upstream")
    const commit = await must_git(config, ["rev-parse", `${tracking_ref}^{commit}`], "Cannot read upstream commit")
    const observed = read_sync_state(config)?.observed_commit
    if (observed && !await ancestor(config, observed, commit)) throw new Error("Upstream history was rewritten; reconcile the branches manually")
    return commit
}

function already_queued(config: Server_Config, commit: string): boolean {
    return ["queue", "running", "done"].some(folder => {
        const path = join(queue_root(config), folder)
        return existsSync(path) && readdirSync(path).filter(name => name.endsWith(".json")).some(name => {
            try { const job = JSON.parse(readFileSync(join(path, name), "utf8")); return job.project === config.site.project && job.commit === commit } catch { return false }
        })
    })
}

function queue_import(config: Server_Config, commit: string, old?: string, source: "upstream" | "checkout" = "upstream"): void {
    if (!already_queued(config, commit)) enqueue(queue_root(config), { kind: source === "checkout" ? "push" : "upstream", project: config.site.project, ref: `refs/heads/${config.site.branch}`, commit, old, pusher: source })
}

export async function poll_project(config: Server_Config): Promise<Sync_State | undefined> {
    let local: Sync_State | undefined
    try {
        const current = await hub_tip(config)
        const saved = read_sync_state(config)
        if (saved?.pending_commit === current) queue_import(config, current, undefined, saved.pending_source)
        if (existsSync(join(config.site.dir, ".git"))) {
            const branch = await git(config, ["-C", config.site.dir, "symbolic-ref", "--short", "HEAD"])
            const status = await git(config, ["-C", config.site.dir, "status", "--porcelain", "--untracked-files=no"])
            if (branch.code === 0 && branch.text === (config.site.checkout_branch ?? config.site.branch) && status.code === 0 && !status.text) {
                await must_git(config, ["fetch", "--quiet", "--no-tags", "--no-write-fetch-head", config.site.dir, `+refs/heads/${branch.text}:refs/jazu-sync/checkout`], "Cannot inspect local checkout commits")
                const commit = await must_git(config, ["rev-parse", "refs/jazu-sync/checkout^{commit}"], "Cannot read local checkout commit")
                if (commit !== current && await ancestor(config, current, commit)) {
                    local = { ...saved, status: "imported", checked_at: Date.now(), commit, pending_commit: commit, pending_source: "checkout" }
                    save_state(config, local)
                    await must_git(config, ["update-ref", `refs/heads/${config.site.branch}`, commit, current], "Hub changed while importing local commits")
                    queue_import(config, commit, current, "checkout")
                    delete local.pending_commit
                    delete local.pending_source
                    save_state(config, local)
                } else if (commit !== current && !await ancestor(config, commit, current)) throw new Error("Local checkout and hub have diverged; merge their histories manually")
            }
        }
    } catch (error) {
        const failed: Sync_State = { ...read_sync_state(config), status: "error", checked_at: Date.now(), message: error instanceof Error ? error.message : String(error) }
        save_state(config, failed)
        return failed
    }
    const upstream = await poll_upstream(config)
    return upstream?.status === "error" ? upstream : local ?? upstream
}

export async function poll_upstream(config: Server_Config): Promise<Sync_State | undefined> {
    if (!config.upstream) return undefined
    let state = read_sync_state(config)
    try {
        const ref = `refs/heads/${config.site.branch}`
        const current = await hub_tip(config)
        // Complete an interrupted update-ref/enqueue pair before another fetch can replace the saved intent.
        if (state?.pending_commit === current) queue_import(config, current, undefined, state.pending_source)
        const remote = await fetch_upstream(config)
        state = { status: "unchanged", checked_at: Date.now(), commit: remote, observed_commit: remote }
        if (current !== remote && await ancestor(config, current, remote)) {
            state.pending_commit = remote
            save_state(config, state)
            await must_git(config, ["update-ref", ref, remote, current], "Hub changed during upstream fetch; retrying on the next poll")
            queue_import(config, remote, current)
            state.status = "imported"
            delete state.pending_commit
        } else if (current !== remote) {
            if (!await ancestor(config, remote, current)) throw new Error("Hub and upstream have diverged; merge their histories manually and push the result")
            state.status = "ahead"
        }
        save_state(config, state)
        return state
    } catch (error) {
        const failed: Sync_State = { ...state, status: "error", checked_at: Date.now(), message: error instanceof Error ? error.message : String(error) }
        save_state(config, failed)
        return failed
    }
}

export async function push_upstream(config: Server_Config, commit: string): Promise<void> {
    if (!config.upstream) return
    try {
        const remote = await fetch_upstream(config)
        if (remote !== commit) {
            if (!await ancestor(config, remote, commit)) throw new Error("Upstream has newer or divergent changes; import and test them before publishing")
            // An explicit SHA refspec cannot accidentally publish a newer, untested hub tip.
            await must_git(config, ["push", "--porcelain", config.upstream.remote, `${commit}:refs/heads/${config.upstream.branch}`], "Cannot update upstream without rewriting history")
        }
        save_state(config, { status: remote === commit ? "unchanged" : "pushed", checked_at: Date.now(), commit, observed_commit: commit })
    } catch (error) {
        save_state(config, { ...read_sync_state(config), status: "error", checked_at: Date.now(), message: error instanceof Error ? error.message : String(error) })
        throw error
    }
}
