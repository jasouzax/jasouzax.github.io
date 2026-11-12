/*
 * Runner of the personal node: the one place where pipeline jobs are taken from the queue and executed.
 *
 * Entities:
 *   start_runner(...)       drains the queue one job at a time (watching queue/ plus a slow poll as a safety net)
 *   plan_batch(...)         coalescing rule: which queued jobs run, which are superseded by a newer one
 *   list_runs(...)          public view of recent runs (no pusher names, no messages, no paths)
 *   start_site_watcher(...) debounced fs.watch on the working copy that queues a `site_changed` job
 *   make_log(...)           append-only run log with a size cap
 *
 * Scope:
 *   Strictly sequential: pipelines have separate working copies but share the mirror overlay and engine publication.
 *   A burst of pushes runs only the newest commit per project/branch (older ones are marked superseded, their commits are
 *   still in the repository). Watches only content/, src/ and config.json like `npm run watch`; watching the whole
 *   tree would add an inotify watch for every file in node_modules and .git.
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, watch, writeFileSync } from "node:fs"
import type { FSWatcher } from "node:fs"
import { execFileSync } from "node:child_process"
import { join } from "node:path"
import { claim, enqueue, finish, pending, recover } from "./queue.ts"
import type { Job, Queued } from "./queue.ts"
import type { Log, Pipeline_Steps, Run_Record } from "./pipeline.ts"
import type { Server_Config } from "./server_config.ts"
import { is_active, load_server_config, project_ids, project_view, project_branches, project_branch } from "./server_config.ts"
import { sync_repositories } from "./git_hooks.ts"
import { hub_tip, poll_project } from "./repo_sync.ts"
import { fresh_catalog, listener_fingerprint, listener_updated, run_job_process } from "./job_process.ts"

export type Runner = { stop(): void, drain(): Promise<void>, busy(): boolean }
const log_cap = 2 * 1024 * 1024

function runs_dir(state: string): string {
    const path = join(state, "runs")
    mkdirSync(path, { recursive: true })
    return path
}

export function make_log(file: string, cap = log_cap): Log {
    let written = 0
    return text => {
        if (written > cap) return
        written += text.length
        appendFileSync(file, written > cap ? "\n[log truncated]\n" : text)
    }
}

// Newest job per project wins; a site_changed job is redundant when a push/manual job is in the same batch, because its CD builds the working copy anyway.
export function plan_batch(queued: Queued[], tip?: string | Record<string, string>): { run: Queued[], superseded: Queued[] } {
    const run: Queued[] = []
    const superseded: Queued[] = []
    for (const item of queued) {
        const same_branch = (other: Queued) => other.job.project === item.job.project && other.job.ref === item.job.ref
        const has_commit_job = queued.some(other => same_branch(other) && other.job.kind !== "site_changed")
        const same = (other: Queued) => same_branch(other) && (other.job.kind === "site_changed") === (item.job.kind === "site_changed")
        // A push hook and an upstream import can enqueue out of ref-update order. Prefer the actual branch tip.
        const preferred = (other: Queued) => Boolean(tip && other.job.commit === (typeof tip === "string" ? tip : tip[`${other.job.project}:${other.job.ref}`] ?? tip[other.job.project]))
        const newer = queued.some(other => same(other) && ((preferred(other) && !preferred(item)) || (preferred(other) === preferred(item) && other.name > item.name)))
        if (newer || (item.job.kind === "site_changed" && has_commit_job)) superseded.push(item)
        else run.push(item)
    }
    return { run, superseded }
}

function new_record(job: Job): Run_Record {
    return { id: job.id, kind: job.kind, project: job.project, state: "queued", queued_at: job.queued_at, commit: job.commit, ref: job.ref, pusher: job.pusher, steps: [] }
}

export function list_runs(state: string, project: string, limit: number, branch?: string): Partial<Run_Record>[] {
    const dir = runs_dir(state)
    return readdirSync(dir).filter(name => name.endsWith(".json")).sort().reverse().flatMap(name => {
        try {
            const record = JSON.parse(readFileSync(join(dir, name), "utf8")) as Run_Record
            if (record.project !== project) return []
            if (branch && record.ref !== `refs/heads/${branch}`) return []
            const { id, kind, state: run_state, commit, ref, queued_at, started_at, finished_at, deployed } = record
            return [{ id, kind, state: run_state, commit, ref, queued_at, started_at, finished_at, deployed, steps: record.steps.map(step => ({ name: step.name, ok: step.ok, code: step.code, ms: step.ms })) }]
        } catch { return [] }
    }).slice(0, limit)
}

export function start_runner(config: Server_Config, options: { steps?: Pipeline_Steps, server_env?: NodeJS.ProcessEnv, poll_ms?: number, isolated?: boolean, on_restart?: () => void } = {}): Runner {
    const state = config.state_dir
    let running = false
    let again = false
    let watcher: FSWatcher | undefined
    let timer: NodeJS.Timeout | undefined
    let stopped = false
    let catalog_error = ""
    const isolated = options.isolated !== false && !options.steps
    const fingerprint = listener_fingerprint(config.site.dir)
    const last_upstream_poll = new Map<string, number>()
    const watch_catalog = Boolean(config.catalog)

    const process_job = async (item: Queued): Promise<void> => {
        if (!claim(state, item.name)) return
        const record = new_record(item.job)
        const file = join(runs_dir(state), `${item.job.id}.json`)
        const save = () => writeFileSync(file, JSON.stringify(record, null, 2))
        const log = make_log(join(runs_dir(state), `${item.job.id}.log`))
        record.state = "running"
        record.started_at = Date.now()
        save()
        console.log(`[ci] ${item.job.kind} ${item.job.commit?.slice(0, 8) ?? ""} started`)
        try {
            if (isolated) await run_job_process(config, item.job, record, log, options.server_env ?? process.env)
            else await (await import("./pipeline.ts")).run_pipeline(config, item.job, record, log, save, options.steps, options.server_env ?? process.env)
        } catch (error) {
            record.state = "failed"
            record.finished_at = Date.now()
            record.message = error instanceof Error ? error.message : String(error)
            log(`\n[worker error] ${record.message}\n`)
            save()
        }
        console.log(`[ci] ${item.job.kind} ${item.job.commit?.slice(0, 8) ?? ""} ${record.state}${record.message ? `: ${record.message}` : ""}`)
        finish(state, item.name)
    }

    const supersede = (item: Queued): void => {
        if (!claim(state, item.name)) return
        const record = new_record(item.job)
        record.state = "superseded"
        record.finished_at = Date.now()
        writeFileSync(join(runs_dir(state), `${item.job.id}.json`), JSON.stringify(record, null, 2))
        finish(state, item.name)
    }

    const drain = async (): Promise<void> => {
        if (stopped) return
        if (running) { again = true; return }
        running = true
        try {
            do {
                again = false
                if (options.on_restart && listener_updated(config.site.dir, fingerprint)) {
                    stopped = true
                    watcher?.close()
                    clearInterval(timer)
                    console.log("[listener] engine runtime changed; restarting before the next job")
                    options.on_restart()
                    break
                }
                if (watch_catalog || isolated) {
                    try {
                        const fresh = isolated ? await fresh_catalog(config) : load_server_config(config.file, JSON.parse(process.env.JAZU_REPOSITORIES_JSON ?? "{}"))
                        if (JSON.stringify(fresh.projects) !== JSON.stringify(config.projects)) {
                            config.projects = fresh.projects
                            config.pipeline = fresh.pipeline
                            config.pipelines = fresh.pipelines
                            config.upstream = fresh.upstream
                            config.site.branch = fresh.site.branch
                            sync_repositories(config)
                        }
                        catalog_error = ""
                    } catch (error) {
                        const message = error instanceof Error ? error.message : String(error)
                        if (message !== catalog_error) console.error(`[catalog] ${message}; retaining last valid catalog and continuing repository polling`)
                        catalog_error = message
                    }
                }
                const active = project_ids(config).filter(id => is_active(config, id))
                for (const id of active) for (const branch of project_branches(config, id)) {
                    const view = project_view(config, id, branch)
                    const key = `${id}:${branch}`
                    const interval = (view.upstream?.poll_seconds ?? view.pipeline?.poll_seconds ?? 60) * 1000
                    if (Date.now() - (last_upstream_poll.get(key) ?? 0) < interval) continue
                    last_upstream_poll.set(key, Date.now())
                    const sync = await poll_project(view)
                    if (sync?.status === "error") console.error(`[sync:${id}] ${sync.message}`)
                    if (sync?.status === "imported") console.log(`[sync:${id}] imported ${sync.commit?.slice(0, 8)}; CI/CD queued`)
                }
                const queued = pending(state).map(item => ({ ...item, job: { ...item.job, ref: item.job.ref ?? `refs/heads/${project_branch(config, item.job.project)}` } }))
                const tips: Record<string, string> = {}
                for (const item of queued) if (is_active(config, item.job.project)) {
                    const branch = item.job.ref!.replace(/^refs\/heads\//, "")
                    if (project_branches(config, item.job.project).includes(branch)) tips[`${item.job.project}:${item.job.ref}`] = await hub_tip(project_view(config, item.job.project, branch))
                }
                const { run, superseded } = plan_batch(queued, tips)
                superseded.forEach(supersede)
                for (const item of run) {
                    await process_job(item)
                    if (options.on_restart && listener_updated(config.site.dir, fingerprint)) break
                }
                if (run.length || superseded.length) again = true
            } while (again && !stopped)
        } catch (error) { console.error(`[ci] runner error: ${error instanceof Error ? error.message : error}`) }
        finally { running = false }
    }

    const recovered = recover(state)
    if (recovered) console.log(`[ci] re-queued ${recovered} interrupted job(s)`)
    mkdirSync(join(state, "queue"), { recursive: true })
    watcher = watch(join(state, "queue"), () => void drain())
    timer = setInterval(() => void drain(), options.poll_ms ?? 5000)
    void drain()
    return { stop: () => { stopped = true; watcher?.close(); clearInterval(timer) }, drain, busy: () => running }
}

const ignored_edit = /(~|\.swp|\.swx|\.tmp|\.#.*|^\.DS_Store|Thumbs\.db)$/

// Direct edits to the working copy queue one CD run after `debounce_ms` of quiet; events during a run are ignored
// (the pipeline itself writes into the working copy) and a changed-nothing build is a cheap no-op anyway.
export function start_site_watcher(config: Server_Config, is_busy: () => boolean, debounce_ms = 5000): { close(): void } {
    const watchers: FSWatcher[] = []
    let timer: NodeJS.Timeout | undefined
    let quiet_until = 0
    const changed = (name: string | null) => {
        if (!name || ignored_edit.test(name) || is_busy() || Date.now() < quiet_until) return
        clearTimeout(timer)
        timer = setTimeout(() => {
            if (is_busy()) return
            quiet_until = Date.now() + 3000
            const branches = project_branches(config, config.site.project)
            try {
                const branch = branches.length > 1 ? execFileSync("git", ["symbolic-ref", "--short", "HEAD"], { cwd: config.site.dir, encoding: "utf8", windowsHide: true }).trim() : config.site.branch
                if (branches.includes(branch)) enqueue(config.state_dir, { kind: "site_changed", project: config.site.project, ref: `refs/heads/${branch}` })
            } catch (error) { console.error(`[watch] cannot select a pipeline branch: ${error instanceof Error ? error.message : error}`) }
        }, debounce_ms)
    }
    for (const entry of ["content", "src", "config.json"]) {
        const path = join(config.site.dir, entry)
        if (existsSync(path)) watchers.push(watch(path, { recursive: statSync(path).isDirectory() }, (_event, name) => changed(name)))
    }
    return { close: () => { clearTimeout(timer); watchers.forEach(item => item.close()) } }
}
