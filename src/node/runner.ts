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
 *   Strictly sequential: two pipelines never overlap, because they share the working copy and the Pages deploy.
 *   A burst of pushes runs only the newest commit per project (older ones are marked superseded, their commits are
 *   still in the repository). Watches only content/, src/ and config.json like `npm run watch`; watching the whole
 *   tree would add an inotify watch for every file in node_modules and .git.
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, watch, writeFileSync } from "node:fs"
import type { FSWatcher } from "node:fs"
import { join } from "node:path"
import { claim, enqueue, finish, pending, recover } from "./queue.ts"
import type { Job, Queued } from "./queue.ts"
import { jazu_steps, run_pipeline } from "./ci_jazu.ts"
import type { Log, Pipeline_Steps, Run_Record } from "./ci_jazu.ts"
import type { Server_Config } from "./server_config.ts"

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
export function plan_batch(queued: Queued[]): { run: Queued[], superseded: Queued[] } {
    const run: Queued[] = []
    const superseded: Queued[] = []
    const has_commit_job = queued.some(item => item.job.kind !== "site_changed")
    for (const item of queued) {
        const same = (other: Queued) => other.job.project === item.job.project && (other.job.kind === "site_changed") === (item.job.kind === "site_changed")
        const newer = queued.some(other => other.name > item.name && same(other))
        if (newer || (item.job.kind === "site_changed" && has_commit_job)) superseded.push(item)
        else run.push(item)
    }
    return { run, superseded }
}

function new_record(job: Job): Run_Record {
    return { id: job.id, kind: job.kind, project: job.project, state: "queued", queued_at: job.queued_at, commit: job.commit, ref: job.ref, pusher: job.pusher, steps: [] }
}

export function list_runs(state: string, project: string, limit: number): Partial<Run_Record>[] {
    const dir = runs_dir(state)
    return readdirSync(dir).filter(name => name.endsWith(".json")).sort().reverse().flatMap(name => {
        try {
            const record = JSON.parse(readFileSync(join(dir, name), "utf8")) as Run_Record
            if (record.project !== project) return []
            const { id, kind, state: run_state, commit, ref, queued_at, started_at, finished_at, deployed } = record
            return [{ id, kind, state: run_state, commit, ref, queued_at, started_at, finished_at, deployed, steps: record.steps.map(step => ({ name: step.name, ok: step.ok, code: step.code, ms: step.ms })) }]
        } catch { return [] }
    }).slice(0, limit)
}

export function start_runner(config: Server_Config, options: { steps?: Pipeline_Steps, server_env?: NodeJS.ProcessEnv, poll_ms?: number } = {}): Runner {
    const state = config.state_dir
    let running = false
    let again = false
    let watcher: FSWatcher | undefined
    let timer: NodeJS.Timeout | undefined

    const process_job = async (item: Queued): Promise<void> => {
        if (!claim(state, item.name)) return
        const record = new_record(item.job)
        const file = join(runs_dir(state), `${item.job.id}.json`)
        const save = () => writeFileSync(file, JSON.stringify(record, null, 2))
        const log = make_log(join(runs_dir(state), `${item.job.id}.log`))
        save()
        console.log(`[ci] ${item.job.kind} ${item.job.commit?.slice(0, 8) ?? ""} started`)
        await run_pipeline(config, item.job, record, log, save, options.steps ?? jazu_steps, options.server_env ?? process.env)
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
        if (running) { again = true; return }
        running = true
        try {
            do {
                again = false
                const { run, superseded } = plan_batch(pending(state))
                superseded.forEach(supersede)
                for (const item of run) await process_job(item)
                if (run.length || superseded.length) again = true
            } while (again)
        } catch (error) { console.error(`[ci] runner error: ${error instanceof Error ? error.message : error}`) }
        finally { running = false }
    }

    const recovered = recover(state)
    if (recovered) console.log(`[ci] re-queued ${recovered} interrupted job(s)`)
    mkdirSync(join(state, "queue"), { recursive: true })
    watcher = watch(join(state, "queue"), () => void drain())
    timer = setInterval(() => void drain(), options.poll_ms ?? 5000)
    void drain()
    return { stop: () => { watcher?.close(); clearInterval(timer) }, drain, busy: () => running }
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
        timer = setTimeout(() => { quiet_until = Date.now() + 3000; enqueue(config.state_dir, { kind: "site_changed", project: config.site.project }) }, debounce_ms)
    }
    for (const entry of ["content", "src", "config.json"]) {
        const path = join(config.site.dir, entry)
        if (existsSync(path)) watchers.push(watch(path, { recursive: statSync(path).isDirectory() }, (_event, name) => changed(name)))
    }
    return { close: () => { clearTimeout(timer); watchers.forEach(item => item.close()) } }
}
