/*
 * Durable job queue on the filesystem (`<state_dir>/queue|running|done`).
 *
 * Entities:
 *   Job                  what happened (a push to the deploy branch, a file change, or a manual request)
 *   enqueue(state, job)  atomic write (temp + rename) so a half-written job is never seen by the runner
 *   pending / claim / finish / recover   runner side; claim is a rename, so two runners cannot take one job
 *
 * Scope:
 *   Git hooks are separate short-lived processes, so the queue is a directory, not memory: jobs survive a node
 *   restart and a crashed run is re-queued by `recover`. Knows nothing about git or CI.
 */
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { randomUUID } from "node:crypto"

export type Job_Kind = "push" | "manual" | "upstream" | "site_changed"
export type Job = {
    id: string
    kind: Job_Kind
    project: string
    queued_at: number
    ref?: string
    old?: string
    commit?: string
    pusher?: string
}
export type Queued = { name: string, job: Job }

const keep_done = 50

function folder(state: string, name: "queue" | "running" | "done"): string {
    const path = join(state, name)
    mkdirSync(path, { recursive: true })
    return path
}

// Ids must sort in arrival order even within one millisecond, so the timestamp never repeats inside this process.
let last_stamp = 0

export function enqueue(state: string, job: Omit<Job, "id" | "queued_at">): Job {
    const queued_at = last_stamp = Math.max(Date.now(), last_stamp + 1)
    const id = `${String(queued_at).padStart(13, "0")}_${randomUUID().slice(0, 8)}`
    const full: Job = { ...job, id, queued_at }
    const target = folder(state, "queue")
    const temp = join(state, `.${id}.tmp`)
    writeFileSync(temp, JSON.stringify(full))
    renameSync(temp, join(target, `${id}.json`))
    return full
}

function read_job(path: string): Job | null {
    try { return JSON.parse(readFileSync(path, "utf8")) as Job } catch { return null }
}

// Oldest first; ids start with a zero-padded timestamp, so name order is arrival order.
export function pending(state: string): Queued[] {
    const dir = folder(state, "queue")
    return readdirSync(dir).filter(name => name.endsWith(".json")).sort().flatMap(name => {
        const job = read_job(join(dir, name))
        return job ? [{ name, job }] : []
    })
}

export function claim(state: string, name: string): boolean {
    try { renameSync(join(folder(state, "queue"), name), join(folder(state, "running"), name)); return true } catch { return false }
}

export function finish(state: string, name: string): void {
    renameSync(join(folder(state, "running"), name), join(folder(state, "done"), name))
    const done = folder(state, "done")
    for (const old of readdirSync(done).sort().slice(0, -keep_done)) rmSync(join(done, old), { force: true })
}

// Jobs left in running/ belong to a node that died mid-run; the pipeline is idempotent, so they simply run again.
export function recover(state: string): number {
    const running = folder(state, "running")
    const names = readdirSync(running).filter(name => name.endsWith(".json"))
    for (const name of names) renameSync(join(running, name), join(folder(state, "queue"), name))
    return names.length
}
