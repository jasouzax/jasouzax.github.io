/* Provider credentials are sealed per session; message encryption keys never pass through this module. */
import { encode_key, decode_key } from "../work_crypto.ts"
import { auth_hash } from "./auth.ts"
import type { Work_Env } from "./work.ts"
const drive_scope = "https://www.googleapis.com/auth/drive.appdata"
type Grant = { access_token: string, refresh_token?: string, expires_at: number }

async function key(token: string): Promise<CryptoKey> {
    return crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`jazu-google-grant-v1\n${token}`)), "AES-GCM", false, ["encrypt", "decrypt"])
}

async function seal(token: string, grant: Grant): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(drive_scope) }, await key(token), new TextEncoder().encode(JSON.stringify(grant)))
    return JSON.stringify({ iv: encode_key(iv), ciphertext: encode_key(new Uint8Array(encrypted)) })
}

export async function save_google_grant(env: Work_Env, token: string, result: Record<string, unknown>): Promise<void> {
    if (typeof result.access_token !== "string" || result.access_token.length > 8192 || typeof result.scope !== "string" || !result.scope.split(" ").includes(drive_scope)) return
    const grant: Grant = { access_token: result.access_token, expires_at: Date.now() + Math.min(3600, Math.max(1, Number(result.expires_in) || 3600)) * 1000 }
    if (typeof result.refresh_token === "string" && result.refresh_token.length <= 8192) grant.refresh_token = result.refresh_token
    await env.DB!.prepare("INSERT OR REPLACE INTO auth_google_grants (session_hash, sealed) VALUES (?, ?)").bind(await auth_hash(token), await seal(token, grant)).run()
}

export async function google_access(env: Work_Env, token: string, upstream: typeof fetch = fetch): Promise<string> {
    const row = await env.DB!.prepare("SELECT sealed FROM auth_google_grants WHERE session_hash = ?").bind(await auth_hash(token)).first<{ sealed: string }>()
    if (!row) throw new Error("drive_consent_required")
    const envelope = JSON.parse(row.sealed)
    const grant = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode_key(envelope.iv), additionalData: new TextEncoder().encode(drive_scope) }, await key(token), decode_key(envelope.ciphertext)))) as Grant
    if (grant.expires_at > Date.now() + 60000) return grant.access_token
    if (!grant.refresh_token) throw new Error("drive_consent_required")
    const response = await upstream("https://oauth2.googleapis.com/token", { method: "POST", redirect: "manual", signal: AbortSignal.timeout(10000), body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET!, grant_type: "refresh_token", refresh_token: grant.refresh_token }) })
    if (!response.ok) throw new Error("drive_consent_required")
    const result = await response.json() as { access_token?: string, expires_in?: number }
    if (!result.access_token || result.access_token.length > 8192) throw new Error("drive_consent_required")
    grant.access_token = result.access_token
    grant.expires_at = Date.now() + Math.min(3600, Math.max(1, result.expires_in ?? 3600)) * 1000
    await env.DB!.prepare("UPDATE auth_google_grants SET sealed = ? WHERE session_hash = ?").bind(await seal(token, grant), await auth_hash(token)).run()
    return grant.access_token
}
