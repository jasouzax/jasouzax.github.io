import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

// Applies migrations/*.sql through the D1 HTTP API, recording them in the same
// `d1_migrations` table layout wrangler used, so existing databases stay compatible.
if (existsSync(".env")) process.loadEnvFile(".env")
const token = process.env.CLOUDFLARE_API_TOKEN
const account = process.env.CLOUDFLARE_ACCOUNT_ID
const database = process.env.D1_DATABASE_ID
if (!token || !account || !database) throw new Error("CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID and D1_DATABASE_ID are required")

async function query(sql: string, params: unknown[] = []): Promise<{ results: Record<string, unknown>[] }> {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/query`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ sql, params }),
    })
    const body = await response.json() as { success: boolean, errors?: unknown[], result?: { results: Record<string, unknown>[] }[] }
    if (!response.ok || !body.success) throw new Error(`D1 query failed: ${JSON.stringify(body.errors ?? response.status)}`)
    return body.result?.[0] ?? { results: [] }
}

const dir = join(process.cwd(), "migrations")
await query("CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)")
const applied = new Set((await query("SELECT name FROM d1_migrations")).results.map(row => String(row.name)))
for (const name of readdirSync(dir).filter(file => file.endsWith(".sql")).sort()) {
    if (applied.has(name)) continue
    console.log(`Applying ${name}`)
    await query(readFileSync(join(dir, name), "utf8"))
    await query("INSERT INTO d1_migrations (name) VALUES (?)", [name])
}
console.log("D1 migrations up to date")
