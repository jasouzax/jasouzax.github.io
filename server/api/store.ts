/* One SQLite file per API id, next to its authored scripts. Only this module owns platform store/audit SQL. */
import { DatabaseSync } from "node:sqlite"
import { chmodSync } from "node:fs"
export class Api_Store {
    readonly db: DatabaseSync
    private transaction_depth = 0
    constructor(file: string) {
        this.db = new DatabaseSync(file)
        chmodSync(file, 0o600)
        this.db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS api_values (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS api_audit (seq INTEGER PRIMARY KEY, time INTEGER NOT NULL, event TEXT NOT NULL, detail TEXT NOT NULL)")
    }
    get<T = unknown>(key: string): T | undefined { const row = this.db.prepare("SELECT value FROM api_values WHERE key = ?").get(key); return row ? JSON.parse(String(row.value)) as T : undefined }
    set(key: string, value: unknown): void {
        const json = JSON.stringify(value)
        if (!json || json.length > 512 * 1024 || key.length > 1024) throw new Error("Invalid store value or key size")
        this.db.prepare("INSERT INTO api_values VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, json)
    }
    delete(key: string): boolean { return Number(this.db.prepare("DELETE FROM api_values WHERE key = ?").run(key).changes) > 0 }
    keys(prefix = ""): string[] { return this.db.prepare("SELECT key FROM api_values WHERE substr(key,1,length(?)) = ? ORDER BY key LIMIT 1000").all(prefix, prefix).map(row => String(row.key)) }
    transaction<T>(action: () => T): T {
        const depth = this.transaction_depth, savepoint = `api_tx_${depth}`
        this.db.exec(depth ? `SAVEPOINT ${savepoint}` : "BEGIN IMMEDIATE"); this.transaction_depth++
        try { const result = action(); if (result && typeof (result as any).then === "function") throw new Error("Store transactions must be synchronous"); this.db.exec(depth ? `RELEASE ${savepoint}` : "COMMIT"); return result }
        catch (error) { this.db.exec(depth ? `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}` : "ROLLBACK"); throw error }
        finally { this.transaction_depth-- }
    }
    audit(event: string, detail: unknown): void {
        this.db.prepare("INSERT INTO api_audit(time,event,detail) VALUES (?,?,?)").run(Date.now(), event, JSON.stringify(detail))
        this.db.exec("DELETE FROM api_audit WHERE seq <= (SELECT coalesce(max(seq),0)-10000 FROM api_audit)")
    }
    close(): void { this.db.close() }
}
