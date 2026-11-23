/* Local operator commands for the running signed API supervisor; deployment never writes cloud state. */
import { existsSync } from "node:fs"
import { join, resolve } from "node:path"
import { sign_origin } from "../../shared/sign.ts"
import { createHash, randomBytes } from "node:crypto"
export async function api_command(root: string, words: string[], flags: Record<string, string | boolean>): Promise<void> {
    if (existsSync(join(root, ".env"))) process.loadEnvFile(join(root, ".env"))
    const [action, name, version] = words
    if (action === "token") { const token = randomBytes(32).toString("base64url"); console.log(JSON.stringify({ token, hash: createHash("sha256").update(token).digest("hex") }, null, 2)); return }
    if (!["deploy", "rollback", "stop", "status"].includes(action)) throw new Error("Usage: server api deploy <file.auto.js> | rollback <id> <version> | stop <id> <version> | status [--port 8788]")
    const secret = process.env.ORIGIN_HMAC_SECRET ?? ""
    if (secret.length < 32) throw new Error("Set ORIGIN_HMAC_SECRET for API management")
    const body = JSON.stringify(action === "deploy" ? { source: resolve(root, name ?? "") } : action === "status" ? {} : { id: name, version: Number(version?.replace(/^v/, "")) })
    const target = new URL(`/custom-api/_/${action}`, `http://127.0.0.1:${Number(flags.port ?? 8788)}`)
    const request = new Request(target, { method: "POST", body })
    const headers = await sign_origin(request, secret, "api-admin")
    headers.set("content-type", "application/json")
    const response = await fetch(target, { method: "POST", body, headers, signal: AbortSignal.timeout(15000), redirect: "error" })
    const value = await response.json()
    if (!response.ok) throw new Error((value as any).error?.message || `API management failed (${response.status})`)
    console.log(JSON.stringify(value, null, 2))
}
