/* Durable background jobs. Restarts mark old work interrupted; only newly enqueued jobs execute automatically. */
import { randomUUID } from "node:crypto"
import type { Api_Store } from "./store.ts"
import { data_hash, data_json } from "./data.ts"
import { Api_Error } from "./output.ts"
type Job_Handler = (input: any, context: { id: string, signal: AbortSignal }) => unknown | Promise<unknown>
export type Job_Info = { id: string, name: string, state: "queued" | "running" | "succeeded" | "failed" | "interrupted" | "cancelled", input: unknown, result: unknown, error: string | null, created_at: number, updated_at: number }
export class Api_Jobs {
    readonly handlers = new Map<string, Job_Handler>()
    readonly controllers = new Map<string, AbortController>()
    private queue: string[] = []
    private active = false
    private busy = false
    readonly store: Api_Store
    readonly version: number
    readonly run_id: string
    constructor(store: Api_Store, version: number, run_id: string) {
        this.store = store; this.version = version; this.run_id = run_id
        store.db.exec("CREATE TABLE IF NOT EXISTS api_jobs (id TEXT PRIMARY KEY, version INTEGER NOT NULL, run_id TEXT NOT NULL, name TEXT NOT NULL, state TEXT NOT NULL, input TEXT NOT NULL, input_hash TEXT NOT NULL, result TEXT, error TEXT, idem_key TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(version,name,idem_key))")
    }
    register(name: string, handler: Job_Handler): { run: (input?: unknown, options?: { key?: string }) => Job_Info } {
        if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(name) || this.handlers.has(name) || typeof handler !== "function") throw new Error("Invalid or duplicate job name")
        this.handlers.set(name, handler)
        return { run: (input = null, options = {}) => this.run(name, input, options) }
    }
    activate(): void {
        this.store.db.prepare("UPDATE api_jobs SET state = 'interrupted', updated_at = ? WHERE version = ? AND run_id != ? AND state IN ('queued','running')").run(Date.now(), this.version, this.run_id)
        this.active = true; void this.pump()
    }
    run(name: string, input: unknown = null, options: { key?: string } = {}): Job_Info { return this.store.transaction(() => this.enqueue(name, input, options)) }
    private enqueue(name: string, input: unknown, options: { key?: string }): Job_Info {
        if (!this.handlers.has(name)) throw new Error("Unknown API job")
        if (options.key !== undefined && (typeof options.key !== "string" || !options.key || options.key.length > 128)) throw new Api_Error("invalid_key", "Job idempotency keys must contain 1..128 characters")
        const hash = data_hash(input), key = options.key === undefined ? null : data_hash(options.key)
        if (key) {
            const previous = this.store.db.prepare("SELECT id,input_hash FROM api_jobs WHERE version = ? AND name = ? AND idem_key = ?").get(this.version, name, key)
            if (previous) { if (previous.input_hash !== hash) throw new Api_Error("idempotency_conflict", "This job key already belongs to a different payload", 409); return this.get(String(previous.id))! }
        }
        if (this.queue.length >= 1000) throw new Api_Error("busy", "The job queue is full", 503)
        const id = randomUUID(), now = Date.now()
        this.store.db.prepare("INSERT INTO api_jobs(id,version,run_id,name,state,input,input_hash,idem_key,created_at,updated_at) VALUES (?,?,?,?,'queued',?,?,?,?,?)").run(id, this.version, this.run_id, name, data_json(input), hash, key, now, now)
        this.queue.push(id); if (this.active) queueMicrotask(() => { void this.pump() })
        return this.get(id)!
    }
    get(id: string): Job_Info | null {
        const row = this.store.db.prepare("SELECT id,name,state,input,result,error,created_at,updated_at FROM api_jobs WHERE id = ? AND version = ?").get(id, this.version)
        return row ? { ...row, input: JSON.parse(String(row.input)), result: row.result === null ? null : JSON.parse(String(row.result)) } as Job_Info : null
    }
    list(): Job_Info[] { return this.store.db.prepare("SELECT id FROM api_jobs WHERE version = ? ORDER BY created_at DESC LIMIT 100").all(this.version).map(row => this.get(String(row.id))!) }
    cancel(id: string): boolean {
        const updated = this.store.db.prepare("UPDATE api_jobs SET state = 'cancelled', updated_at = ? WHERE id = ? AND version = ? AND state IN ('queued','running')").run(Date.now(), id, this.version)
        this.controllers.get(id)?.abort()
        return Number(updated.changes) > 0
    }
    private async pump(): Promise<void> {
        if (this.busy || !this.active) return
        this.busy = true
        try {
            while (this.active && this.queue.length) {
                const id = this.queue.shift()!, job = this.get(id)
                if (!job || job.state !== "queued") continue
                const controller = new AbortController(); this.controllers.set(id, controller)
                this.store.db.prepare("UPDATE api_jobs SET state = 'running', updated_at = ? WHERE id = ? AND state = 'queued'").run(Date.now(), id)
                let interrupted: (() => void) | undefined
                try {
                    const result = await Promise.race([Promise.resolve().then(() => this.handlers.get(job.name)!(job.input, { id, signal: controller.signal })), new Promise((_, reject) => { interrupted = () => reject(new Error("Job interrupted")); controller.signal.addEventListener("abort", interrupted, { once: true }) })])
                    if (this.active) this.store.db.prepare("UPDATE api_jobs SET state = 'succeeded', result = ?, updated_at = ? WHERE id = ? AND state = 'running'").run(data_json(result), Date.now(), id)
                } catch { if (this.active) this.store.db.prepare("UPDATE api_jobs SET state = 'failed', error = 'Job handler failed', updated_at = ? WHERE id = ? AND state = 'running'").run(Date.now(), id) }
                finally { if (interrupted) controller.signal.removeEventListener("abort", interrupted); this.controllers.delete(id); if (this.active) this.store.audit("job", { id, name: job.name, state: this.get(id)?.state }) }
            }
        } finally { this.busy = false }
    }
    close(): void { this.active = false; for (const controller of this.controllers.values()) controller.abort() }
}
