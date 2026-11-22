/* Read-only cloud preflight and append-only generated configuration; never log secret values. */
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs"
import { parseEnv } from "node:util"
import { generateKeyPairSync, randomBytes } from "node:crypto"
import { join } from "node:path"
import type { site_config } from "../../shared/config.ts"

export function persist_generated(root: string, values: Record<string, string>, env: NodeJS.ProcessEnv = process.env): string[] {
    const file = join(root, ".env"), source = existsSync(file) ? readFileSync(file, "utf8") : ""
    const current = parseEnv(source), added: string[] = [], lines: string[] = []
    for (const [name, value] of Object.entries(values)) {
        if (!/^[A-Z][A-Z0-9_]*$/.test(name) || /[\r\n\0]/.test(value)) throw new Error("Invalid generated environment entry")
        if (current[name]) { env[name] ||= current[name]; continue }
        const selected = env[name] || value
        if (!selected) continue
        lines.push(`${name}=${JSON.stringify(selected)}`); added.push(name); env[name] = selected
    }
    if (lines.length) {
        const temporary = file + ".generated.tmp"
        writeFileSync(temporary, source.replace(/\s*$/, "\n") + "\n# BEGIN JAZU GENERATED (existing values are never replaced)\n" + lines.join("\n") + "\n# END JAZU GENERATED\n", { mode: 0o600, flag: "wx" })
        renameSync(temporary, file)
    }
    return added
}

export async function cloud_preflight(root: string, config: site_config, env: NodeJS.ProcessEnv = process.env, request: typeof fetch = fetch): Promise<void> {
    const required = ["CLOUDFLARE_API_TOKEN", "ORIGIN_HMAC_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]
    const missing = required.filter(name => !env[name]?.trim())
    if (missing.length) throw new Error(`Cloud preflight: missing ${missing.join(", ")}`)
    if (env.ORIGIN_HMAC_SECRET!.length < 32) throw new Error("Cloud preflight: ORIGIN_HMAC_SECRET must be at least 32 characters")
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.owner.email)) throw new Error("Cloud preflight: config owner.email is required")
    const api = async <T>(path: string, label: string): Promise<T> => {
        const response = await request(`https://api.cloudflare.com/client/v4${path}`, { headers: { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` }, redirect: "error", signal: AbortSignal.timeout(15000) })
        if (!response.ok) throw new Error(`Cloud preflight: ${label} denied (${response.status}); check token permissions and resource scope`)
        const body = await response.json() as { success: boolean, result: T }
        if (!body.success) throw new Error(`Cloud preflight: ${label} failed`)
        return body.result
    }
    const accounts = await api<{ id: string }[]>("/accounts?per_page=50", "account discovery")
    const account = env.CLOUDFLARE_ACCOUNT_ID || (accounts.length === 1 ? accounts[0].id : "")
    if (!account || !accounts.some(item => item.id === account)) throw new Error("Cloud preflight: set CLOUDFLARE_ACCOUNT_ID to an account accessible to this token")
    if (!/^[a-f0-9]{32}$/i.test(account)) throw new Error("Cloud preflight: invalid account ID")
    const host = new URL(config.base_url).hostname
    const labels = host.split(".")
    let zones: { id: string, name: string, account?: { id: string } }[] = []
    for (let index = 0; index < labels.length - 1 && !zones.length; index++) zones = await api(`/zones?name=${encodeURIComponent(labels.slice(index).join("."))}&account.id=${account}`, "zone discovery")
    if (zones.length !== 1 || !/^[a-f0-9]{32}$/i.test(zones[0].id)) throw new Error("Cloud preflight: no unique Cloudflare zone matches config.base_url")
    if (env.CLOUDFLARE_ZONE_ID && env.CLOUDFLARE_ZONE_ID !== zones[0].id) throw new Error("Cloud preflight: configured zone does not match config.base_url")
    const probes = [[`/accounts/${account}/pages/projects`, "Pages"], [`/accounts/${account}/workers/scripts`, "Workers"], [`/accounts/${account}/r2/buckets`, "R2"], [`/accounts/${account}/storage/kv/namespaces`, "KV"], [`/accounts/${account}/d1/database`, "D1"], [`/zones/${zones[0].id}/dns_records?per_page=1`, "DNS"], [`/accounts/${account}/access/apps`, "Access"], [`/accounts/${account}/cfd_tunnel?is_deleted=false`, "Tunnel"]]
    const results = await Promise.allSettled(probes.map(([path, label]) => api(path, label)))
    const failures = results.filter((item): item is PromiseRejectedResult => item.status === "rejected")
    if (failures.length) throw new Error(failures.map(item => item.reason.message).join("\n"))
    if (Boolean(env.VAPID_PUBLIC_KEY) !== Boolean(env.VAPID_PRIVATE_KEY)) throw new Error("Cloud preflight: restore the incomplete VAPID key pair; it will not be regenerated")
    const generated: Record<string, string> = { CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_ZONE_ID: zones[0].id, GOOGLE_ADMIN_EMAIL: config.owner.email, VAPID_SUBJECT: `mailto:${config.owner.email}`, AUTH_JWT_SECRET: env.AUTH_JWT_SECRET || randomBytes(32).toString("base64url") }
    if (!env.VAPID_PUBLIC_KEY) {
        const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" }), public_key = pair.publicKey.export({ format: "jwk" }), private_key = pair.privateKey.export({ format: "jwk" })
        generated.VAPID_PUBLIC_KEY = Buffer.concat([Buffer.from([4]), Buffer.from(public_key.x!, "base64url"), Buffer.from(public_key.y!, "base64url")]).toString("base64url")
        generated.VAPID_PRIVATE_KEY = private_key.d!
    }
    persist_generated(root, generated, env)
    env.TF_VAR_account_id ||= account; env.TF_VAR_zone_id ||= zones[0].id
    console.log("Cloud preflight passed account, zone and service-read checks. Write permissions remain subject to Terraform plan/apply validation.")
}
