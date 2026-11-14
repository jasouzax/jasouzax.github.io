/* Client recovery keys sealed outside D1, with immutable writes and verified Drive handoff. */
import type { Work_Env } from "./work.ts"
import { auth_hash, session_token, type Auth_Session } from "./auth.ts"
import { google_access } from "./google_grant.ts"
import { decode_key, encode_key } from "../work_crypto.ts"
import type { Client_Key } from "../web/client/work_drive.ts"
import { api_error } from "./security.ts"

type Backup = { room_id: string, sealed: string }
const reply = (data: unknown) => Response.json(data, { headers: { "cache-control": "no-store", "referrer-policy": "no-referrer", vary: "Cookie" } })
async function canonical(value: unknown): Promise<Client_Key> {
    const key = value as Client_Key, wrap = key?.owner_wrap, jwk = wrap?.public_jwk
    if (!key || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(key.room) || typeof key.key !== "string" || decode_key(key.key).length !== 32 || !/^[a-f0-9]{64}$/.test(key.key_id) || wrap?.v !== 1 || decode_key(wrap.iv).length !== 12 || decode_key(wrap.ciphertext).length !== 48 || jwk?.kty !== "EC" || jwk.crv !== "P-256" || jwk.d || decode_key(jwk.x!).length !== 32 || decode_key(jwk.y!).length !== 32) throw new Error("Invalid recovery key")
    const public_jwk = { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y }
    await crypto.subtle.importKey("jwk", public_jwk, { name: "ECDH", namedCurve: "P-256" }, false, [])
    return { room: key.room, key: key.key, key_id: key.key_id, owner_wrap: { v: 1, iv: wrap.iv, ciphertext: wrap.ciphertext, public_jwk } }
}
async function sealing_key(env: Work_Env): Promise<CryptoKey> {
    if (!env.WORK_FALLBACK_KEY || decode_key(env.WORK_FALLBACK_KEY).length !== 32) throw new Error("Recovery storage is not configured")
    return crypto.subtle.importKey("raw", decode_key(env.WORK_FALLBACK_KEY), "AES-GCM", false, ["encrypt", "decrypt"])
}
const aad = (request: Request, session: Auth_Session, room: string) => new TextEncoder().encode(`jazu-unstored-v1\n${new URL(request.url).origin}\n${session.subject}\n${room}`)
async function restore(request: Request, env: Work_Env, session: Auth_Session, row: Backup): Promise<Client_Key> {
    const sealed = JSON.parse(row.sealed)
    if (sealed.v !== 1) throw new Error("Unknown recovery format")
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode_key(sealed.iv), additionalData: aad(request, session, row.room_id) }, await sealing_key(env), decode_key(sealed.ciphertext))
    const value = await canonical(JSON.parse(new TextDecoder().decode(plain)))
    if (value.room !== row.room_id) throw new Error("Invalid recovery room")
    return value
}
export async function unstored_route(request: Request, env: Work_Env, session: Auth_Session | null, guest_id: number | undefined, data: Record<string, unknown>, upstream: typeof fetch = fetch): Promise<Response> {
    if (!session || session.role !== "client") return api_error("forbidden", "Client sign-in required for recovery storage", 403)
    const db = env.DB!, subject = session.subject
    const load = () => db.prepare("SELECT room_id, sealed FROM unstored_keys WHERE subject = ?").bind(subject).first<Backup>()
    const promotion = await db.prepare("SELECT room_id FROM work_key_promotions WHERE subject = ?").bind(subject).first<{ room_id: string }>()
    try {
        if (data.action === "load") {
            const row = await load()
            return reply({ client: row ? await restore(request, env, session, row) : null, drive_stored: Boolean(promotion) })
        }
        if (data.action === "save") {
            if (promotion) return api_error("drive_key_exists", "Your key was saved to Drive. Reconnect Drive to restore it; no fallback was recreated.", 409)
            const existing = await load()
            if (existing) return reply({ client: await restore(request, env, session, existing) })
            const value = await canonical(data.client)
            const room = await db.prepare("SELECT id, google_subject, guest_id, revoked, owner_wrap, owner_key_id FROM work_rooms WHERE id = ? OR (google_subject = ? AND revoked = 0 AND owner_wrap IS NOT NULL) ORDER BY id LIMIT 2").bind(value.room, subject).all<{ id: string, google_subject: string | null, guest_id: number | null, revoked: number, owner_wrap: string, owner_key_id: string }>()
            if (room.results.some(row => row.id !== value.room || row.revoked || (row.google_subject ? row.google_subject !== subject : row.guest_id !== guest_id) || row.owner_key_id !== value.key_id || JSON.stringify(canonical_wrap(row.owner_wrap)) !== JSON.stringify(value.owner_wrap))) return api_error("key_conflict", "An existing conversation was preserved. Restore its original key.", 409)
            const iv = crypto.getRandomValues(new Uint8Array(12))
            const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(request, session, value.room) }, await sealing_key(env), new TextEncoder().encode(JSON.stringify(value)))
            const sealed = JSON.stringify({ v: 1, iv: encode_key(iv), ciphertext: encode_key(new Uint8Array(ciphertext)) })
            await db.prepare("INSERT OR IGNORE INTO unstored_keys (subject, email, room_id, sealed, created_at) SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM work_key_promotions WHERE subject = ?) AND NOT EXISTS (SELECT 1 FROM work_rooms WHERE google_subject = ? AND revoked = 0 AND owner_wrap IS NOT NULL AND id != ?)").bind(subject, session.email, value.room, sealed, Date.now(), subject, subject, value.room).run()
            const stored = await load()
            return stored ? reply({ client: await restore(request, env, session, stored) }) : api_error("key_conflict", "Recovery storage changed. Refresh the conversation.", 409)
        }
        if (data.action === "drive") {
            const row = await load()
            if (!row) return reply({ removed: true })
            if (!db.batch) return api_error("unavailable", "Recovery handoff is temporarily unavailable", 503)
            const value = await restore(request, env, session, row)
            const file = await db.prepare("SELECT file_id FROM work_key_files WHERE subject = ?").bind(subject).first<{ file_id: string }>()
            if (!file) return api_error("drive_unverified", "Save the recovery key to Drive first", 409)
            const access = await google_access(env, session_token(request), upstream)
            const response = await upstream(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.file_id)}?alt=media`, { redirect: "manual", signal: AbortSignal.timeout(10000), headers: { authorization: `Bearer ${access}` } })
            if (!response.ok) return api_error("drive_unverified", "Drive storage could not be verified. Your recovery key was retained.", 409)
            const uploaded = await response.json() as { v?: number, client?: unknown, owner?: unknown }
            if (uploaded.v !== 2 || uploaded.owner || JSON.stringify(await canonical(uploaded.client)) !== JSON.stringify(value)) return api_error("key_conflict", "Drive contains a different key. Both keys were preserved; guest messages were not transferred.", 409)
            await db.batch([
                db.prepare("INSERT OR IGNORE INTO work_key_promotions (subject, room_id, key_hash) SELECT subject, room_id, ? FROM unstored_keys WHERE subject = ? AND sealed = ?").bind(await auth_hash(value.key), subject, row.sealed),
                db.prepare("DELETE FROM unstored_keys WHERE subject = ? AND sealed = ? AND EXISTS (SELECT 1 FROM work_key_promotions WHERE subject = ? AND room_id = ? AND key_hash = ?)").bind(subject, row.sealed, subject, value.room, await auth_hash(value.key)),
            ])
            return (await load()) ? api_error("key_conflict", "Recovery storage changed. Your key was retained.", 409) : reply({ removed: true })
        }
        return api_error("invalid_request", "Unknown recovery storage action", 400)
    } catch { return api_error("recovery_unavailable", "Recovery storage is unavailable. Existing keys were preserved; try again or reconnect Drive.", 503) }
}
// Normalize the public wrap order used by the existing room API.
function canonical_wrap(serialized: string) {
    const wrap = JSON.parse(serialized)
    return { v: wrap.v, iv: wrap.iv, ciphertext: wrap.ciphertext, public_jwk: { kty: wrap.public_jwk.kty, crv: wrap.public_jwk.crv, x: wrap.public_jwk.x, y: wrap.public_jwk.y } }
}
