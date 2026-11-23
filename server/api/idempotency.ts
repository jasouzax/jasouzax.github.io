/* Request deduplication binds an authenticated principal, route/version, key and payload in the API's SQLite. */
import type { Api_Store } from "./store.ts"
import type { Api_Result } from "../../shared/api/types.ts"
import { data_hash } from "./data.ts"
import { Api_Error } from "./output.ts"
export class Api_Idempotency {
    readonly store: Api_Store
    readonly version: number
    readonly run_id: string
    constructor(store: Api_Store, version: number, run_id: string) {
        this.store = store; this.version = version; this.run_id = run_id
        store.db.exec("CREATE TABLE IF NOT EXISTS api_requests (key TEXT PRIMARY KEY, version INTEGER NOT NULL, run_id TEXT NOT NULL, fingerprint TEXT NOT NULL, state TEXT NOT NULL, result TEXT, created_at INTEGER NOT NULL)")
    }
    activate(): void { this.store.db.prepare("UPDATE api_requests SET state = 'interrupted' WHERE version = ? AND run_id != ? AND state = 'pending'").run(this.version, this.run_id) }
    begin(identity: string, route: string, key: string | undefined, payload: unknown): { key: string, cached?: Api_Result } {
        if (!key || key.length > 128 || /[^\x21-\x7e]/.test(key)) throw new Api_Error("invalid_key", "This route requires a 1..128 character Idempotency-Key header")
        const digest = data_hash([this.version, identity, route, key]), fingerprint = data_hash(payload)
        return this.store.transaction(() => {
            const previous = this.store.db.prepare("SELECT fingerprint,state,result FROM api_requests WHERE key = ?").get(digest)
            if (previous) {
                if (previous.fingerprint !== fingerprint) throw new Api_Error("idempotency_conflict", "This key already belongs to a different request", 409)
                if (previous.state !== "complete") throw new Api_Error(previous.state === "pending" ? "request_pending" : "request_interrupted", "This request is pending or interrupted; reconcile its outcome before using another key", 409)
                return { key: digest, cached: JSON.parse(String(previous.result)) as Api_Result }
            }
            this.store.db.prepare("INSERT INTO api_requests VALUES (?,?,?,?,'pending',NULL,?)").run(digest, this.version, this.run_id, fingerprint, Date.now())
            return { key: digest }
        })
    }
    finish(key: string, result: Api_Result): void { this.store.db.prepare("UPDATE api_requests SET state = 'complete', result = ? WHERE key = ? AND run_id = ?").run(JSON.stringify(result), key, this.run_id) }
}
