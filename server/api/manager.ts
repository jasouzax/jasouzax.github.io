/* Durable API release supervisor: atomic activation, side-by-side versions, restart intent and previous-release rollback. */
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import { dirname, join, resolve } from "node:path"
import { createHash } from "node:crypto"
import { Api_Process } from "./process.ts"
import { api_failure, type Api_Call, type Api_Manifest, type Api_Result } from "../../shared/api/types.ts"
import { valid_subdomain_id } from "../../shared/content/ids.ts"
type Release = { id: string, version: number, source: string, current: string, previous?: string }
export class Api_Manager {
    readonly active = new Map<string, Api_Process>()
    readonly releases = new Map<string, Release>()
    readonly retries = new Map<string, ReturnType<typeof setTimeout>>()
    readonly attempts = new Map<string, number>()
    readonly children = new Set<Api_Process>()
    private queue: Promise<unknown> = Promise.resolve()
    private closing = false
    private closing_task: Promise<void> | null = null
    private audit_failed = false
    readonly control: DatabaseSync
    readonly directory: string
    readonly entry: string
    constructor(directory: string, entry: string) {
        this.directory = directory; this.entry = entry
        mkdirSync(join(directory, "releases"), { recursive: true, mode: 0o700 })
        const lock = join(directory, "supervisor.sqlite")
        this.control = new DatabaseSync(lock); chmodSync(lock, 0o600)
        // SQLite releases this OS lock on process death; service restart needs no stale PID-file override.
        try { this.control.exec("PRAGMA busy_timeout=1000; BEGIN EXCLUSIVE") }
        catch (error) { this.control.close(); throw new Error("Another API supervisor owns this state directory", { cause: error }) }
        const file = join(directory, "state.json")
        try { this.load_records(file) } catch (error) { this.control.exec("ROLLBACK"); this.control.close(); throw error }
    }
    private load_records(file: string): void {
        if (existsSync(file)) {
            const records = JSON.parse(readFileSync(file, "utf8"))
            if (!Array.isArray(records)) throw new Error("Invalid API deployment state")
            for (const record of records) {
                if (!valid_subdomain_id(record.id) || !Number.isInteger(record.version) || record.version < 1 || record.version > 9999 || !/^[a-f0-9]{64}$/.test(record.current) || record.previous && !/^[a-f0-9]{64}$/.test(record.previous) || typeof record.source !== "string") throw new Error("Invalid API release in deployment state")
                const key = `${record.id}/v${record.version}`
                if (this.releases.has(key)) throw new Error("Duplicate API release in deployment state")
                this.releases.set(key, record)
            }
        }
    }
    private audit(event: string, detail: unknown): void {
        try {
            const file = join(this.directory, "audit.jsonl")
            if (existsSync(file) && statSync(file).size > 5 * 1024 * 1024) renameSync(file, `${file}.previous`)
            appendFileSync(file, JSON.stringify({ time: Date.now(), event, detail }) + "\n", { mode: 0o600 })
        } catch { if (!this.audit_failed) { this.audit_failed = true; console.error("API supervisor audit storage is unavailable") } }
    }
    private save(records: Map<string, Release>): void {
        const file = join(this.directory, "state.json"), temporary = `${file}.tmp`
        writeFileSync(temporary, JSON.stringify([...records.values()], null, 2), { mode: 0o600 }); renameSync(temporary, file)
    }
    private serial<T>(task: () => Promise<T>): Promise<T> { const next = this.queue.catch(() => {}).then(() => { if (this.closing) throw new Error("API supervisor is closing"); return task() }); this.queue = next; return next }
    private spawn(file: string, source: string, key?: string): Api_Process {
        const child = new Api_Process(this.entry, file, source, () => {
            this.children.delete(child)
            if (!key || this.active.get(key) !== child) return
            this.active.delete(key)
            if (this.closing || !this.releases.has(key)) return
            const attempt = (this.attempts.get(key) ?? 0) + 1; this.attempts.set(key, attempt)
            this.audit("exit", { key, retry: attempt })
            this.retries.set(key, setTimeout(() => { this.retries.delete(key); void this.serial(() => this.restore_one(key)).catch(() => {}) }, Math.min(30000, 200 * 2 ** Math.min(attempt, 8))))
        }, text => this.audit("script_log", { source, text }))
        this.children.add(child)
        return child
    }
    private async restore_one(key: string): Promise<void> {
        const release = this.releases.get(key)
        if (!release || this.closing || this.active.has(key)) return
        const file = join(this.directory, "releases", `${release.current}.auto.js`)
        if (createHash("sha256").update(readFileSync(file)).digest("hex") !== release.current) throw new Error("API release hash does not match its stored source")
        const child = this.spawn(file, release.source, key)
        this.active.set(key, child)
        try { const manifest = await child.ready; if (`${manifest.id}/v${manifest.version}` !== key) throw new Error("Restored API identity changed") }
        catch (error) { child.child.kill(); this.audit("restore_failed", { key }); throw error }
    }
    async restore(): Promise<void> { for (const key of this.releases.keys()) try { await this.restore_one(key) } catch { /* Failed autostarts remain desired and retry with backoff. */ } }
    deploy(source: string): Promise<Api_Manifest> {
        return this.serial(async () => {
            source = resolve(source)
            if (!source.endsWith(".auto.js")) throw new Error("Deploy a .auto.js source")
            const code = readFileSync(source)
            if (code.length > 512 * 1024) throw new Error("API script exceeds 512 KiB")
            const hash = createHash("sha256").update(code).digest("hex"), file = join(this.directory, "releases", `${hash}.auto.js`)
            writeFileSync(file, code, { mode: 0o600 })
            const candidate = this.spawn(file, source)
            try {
                const manifest = await candidate.ready, key = `${manifest.id}/v${manifest.version}`
                const existing = [...this.releases.values()].find(release => release.id === manifest.id && dirname(release.source) !== dirname(source))
                if (existing) throw new Error("Versions of an API must use the same script directory and SQLite store")
                const previous = this.releases.get(key), record = { id: manifest.id, version: manifest.version, source, current: hash, ...(previous?.current && previous.current !== hash ? { previous: previous.current } : previous?.previous ? { previous: previous.previous } : {}) }
                await this.activate(key, candidate, record)
                return manifest
            } catch (error) { candidate.child.kill(); throw error }
        })
    }
    private async activate(key: string, candidate: Api_Process, record: Release): Promise<void> {
        if (this.closing || !candidate.child.connected) throw new Error("API process is no longer available")
        const updated = new Map(this.releases); updated.set(key, record); this.save(updated)
        const old = this.active.get(key)
        this.releases.set(key, record); this.active.set(key, candidate); this.attempts.delete(key)
        const retry = this.retries.get(key); if (retry) clearTimeout(retry); this.retries.delete(key)
        // A deployed candidate becomes supervised only after readiness and the durable state write succeed.
        candidate.child.once("exit", () => {
            if (this.active.get(key) !== candidate || this.closing) return
            this.active.delete(key)
            this.retries.set(key, setTimeout(() => { this.retries.delete(key); void this.serial(() => this.restore_one(key)).catch(() => {}) }, 200))
        })
        old?.stop(); this.audit("activate", { key, revision: record.current })
    }
    rollback(id: string, version: number): Promise<Api_Manifest> {
        return this.serial(async () => {
            const key = `${id}/v${version}`, record = this.releases.get(key)
            if (!record?.previous) throw new Error("No previous release is available")
            const file = join(this.directory, "releases", `${record.previous}.auto.js`)
            if (createHash("sha256").update(readFileSync(file)).digest("hex") !== record.previous) throw new Error("Rollback release hash does not match its stored source")
            const child = this.spawn(file, record.source)
            try { const manifest = await child.ready; if (`${manifest.id}/v${manifest.version}` !== key) throw new Error("Rollback identity differs"); await this.activate(key, child, { ...record, current: record.previous, previous: record.current }); return manifest }
            catch (error) { child.child.kill(); throw error }
        })
    }
    stop(id: string, version: number): Promise<void> {
        return this.serial(async () => {
            const key = `${id}/v${version}`, updated = new Map(this.releases); updated.delete(key); this.save(updated); this.releases.delete(key)
            const retry = this.retries.get(key); if (retry) clearTimeout(retry); this.retries.delete(key)
            const child = this.active.get(key); this.active.delete(key); child?.stop(); this.audit("stop", { key })
        })
    }
    manifests(): Api_Manifest[] { return [...this.active.values()].flatMap(child => child.manifest ? [child.manifest] : []) }
    call(id: string, version: number, call: Api_Call): Promise<Api_Result> { return this.active.get(`${id}/v${version}`)?.call(call) ?? Promise.resolve(api_failure("not_found", "API unavailable", 404, call.request_id)) }
    close(): Promise<void> {
        if (this.closing_task) return this.closing_task
        this.closing = true
        this.closing_task = (async () => { for (const timer of this.retries.values()) clearTimeout(timer); this.retries.clear(); const children = [...this.children]; for (const child of children) child.child.kill(); this.active.clear(); await Promise.all(children.map(child => child.stopped)); this.control.exec("ROLLBACK"); this.control.close() })()
        return this.closing_task
    }
}
