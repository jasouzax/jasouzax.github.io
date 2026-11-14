/*
 * Encrypted Work API backed by D1, independent of the personal server.
 * Automatic guest cookies or verified Google sessions authenticate participants.
 * D1 stores cookie hashes, public/wrapped keys, ciphertext and separately sealed client recovery keys.
 */
import { api_error } from "./security.ts"
import { decode_key, encode_key, type Work_Envelope } from "../work_crypto.ts"
import { read_session, valid_csrf, auth_hash } from "./auth.ts"
import { google_picture } from "../work_profile.ts"
import { unstored_route } from "./work_unstored.ts"
import type { Realtime_Namespace } from "./realtime_bus.ts"

export type Work_Statement = {
    bind(...values: unknown[]): Work_Statement
    first<T>(): Promise<T | null>
    all<T>(): Promise<{ results: T[] }>
    run(): Promise<unknown>
}
export type Work_Env = {
    DB?: { prepare(sql: string): Work_Statement, batch?(statements: Work_Statement[]): Promise<unknown> }
    WORK_OWNER_EMAIL?: string
    GOOGLE_CLIENT_ID?: string
    GOOGLE_CLIENT_SECRET?: string
    GOOGLE_ADMIN_EMAIL?: string
    WORK_FALLBACK_KEY?: string
    REALTIME?: Realtime_Namespace
}
type Room = { id: string, email: string, token_hash: string, created_at: number, revoked: number, google_subject?: string | null, guest_id?: number | null, owner_wrap?: string | null, owner_key_id?: string | null, name?: string, picture?: string, account_email?: string }
export type Work_Message = { seq: number, id: string, author: "owner" | "client", envelope: string, created_at: number }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const reply = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" } })

async function read_json(request: Request): Promise<Record<string, unknown>> {
    if (!request.headers.get("content-type")?.startsWith("application/json")) throw new Error("Expected application/json")
    const reader = request.body?.getReader()
    if (!reader) throw new Error("Missing body")
    let bytes = new Uint8Array(0)
    try {
        while (true) {
            const { value, done } = await reader.read()
            if (done) break
            if (bytes.length + value.length > 12000) throw new Error("Request is too large")
            const next = new Uint8Array(bytes.length + value.length)
            next.set(bytes); next.set(value, bytes.length); bytes = next
        }
    } finally { await reader.cancel() }
    const data = JSON.parse(new TextDecoder().decode(bytes))
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Expected a JSON object")
    return data
}

function valid_envelope(value: unknown): value is Work_Envelope {
    if (!value || typeof value !== "object") return false
    const entry = value as Work_Envelope
    if (Object.keys(entry).sort().join(",") !== "ciphertext,iv,v" || entry.v !== 1 || typeof entry.iv !== "string" || typeof entry.ciphertext !== "string") return false
    try { return decode_key(entry.iv).length === 12 && decode_key(entry.ciphertext).length >= 17 && decode_key(entry.ciphertext).length <= 8016 } catch { return false }
}

type Owner_Key = { key_id: string, public_jwk: string }
const guest_cookie = "__Host-jazu_guest"
export function guest_token(request: Request): string {
    const values = (request.headers.get("cookie") ?? "").split(";").map(value => value.trim()).filter(value => value.startsWith(guest_cookie + "="))
    const value = values.length === 1 ? values[0].slice(guest_cookie.length + 1) : ""
    return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : ""
}
async function public_key(value: unknown): Promise<JsonWebKey> {
    const jwk = value as JsonWebKey
    if (!jwk || jwk.kty !== "EC" || jwk.crv !== "P-256" || jwk.d || typeof jwk.x !== "string" || typeof jwk.y !== "string" || decode_key(jwk.x).length !== 32 || decode_key(jwk.y).length !== 32) throw new Error("Invalid public key")
    const clean = { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y }
    await crypto.subtle.importKey("jwk", clean, { name: "ECDH", namedCurve: "P-256" }, false, [])
    return clean
}
function room_info(room: Room) {
    return { id: room.id, email: room.google_subject ? room.account_email || room.email : `guest/${room.guest_id}`, name: room.google_subject ? room.name || room.email : "", picture: room.google_subject ? google_picture(room.picture) : "", guest_id: room.guest_id, revoked: room.revoked, owner_wrap: room.owner_wrap ? JSON.parse(room.owner_wrap) : null, owner_key_id: room.owner_key_id }
}

export async function work_route(request: Request, env: Work_Env, dependencies: { fetch?: typeof fetch } = {}): Promise<Response> {
    if (!env.DB || !env.GOOGLE_CLIENT_ID) return api_error("work_unconfigured", "Messaging is not configured yet", 503)
    const url = new URL(request.url)
    if (request.headers.has("authorization")) return api_error("forbidden", "Use your browser session", 403)
    if (request.headers.has("origin") && request.headers.get("origin") !== url.origin) return api_error("forbidden", "Use the workspace on this origin", 403)
    if (!["GET", "POST"].includes(request.method)) return api_error("method_not_allowed", "Use GET or POST", 405)
    if (request.method === "POST" && (request.headers.get("origin") !== url.origin || request.headers.get("x-jazu-work") !== "1")) return api_error("forbidden", "Use the workspace on this origin", 403)
    const session = await read_session(request, env)
    let guest = guest_token(request)
    let guest_row = guest ? await env.DB.prepare("SELECT id FROM work_guests WHERE cookie_hash = ? AND created_at > ?").bind(await auth_hash(guest), Date.now() - 365 * 86400000).first<{ id: number }>() : null
    const owner = session?.role === "owner"
    const owner_key = await env.DB.prepare("SELECT key_id, public_jwk FROM work_owner_keys WHERE id = 1").first<Owner_Key>()
    const base = "/api/v1/work/rooms"
    if (url.pathname === "/api/v1/work/session" && request.method === "POST") {
        if (session && !valid_csrf(request, session)) return api_error("forbidden", "Refresh the workspace", 403)
        if (!session && guest_row) {
            const previous = await env.DB.prepare("SELECT google_subject, revoked FROM work_rooms WHERE guest_id = ?").bind(guest_row.id).first<{ google_subject: string | null, revoked: number }>()
            // A linked/closed room must never remain the signed-out browser's writable guest identity.
            if (previous?.google_subject || previous?.revoked) guest_row = null
        }
        if (!session && !guest_row) {
            const ip_day = await auth_hash(`${new Date().toISOString().slice(0, 10)}\n${request.headers.get("cf-connecting-ip") ?? "unknown"}`)
            guest = encode_key(crypto.getRandomValues(new Uint8Array(32)))
            guest_row = await env.DB.prepare("INSERT INTO work_guests (cookie_hash, ip_day, created_at) SELECT ?, ?, ? WHERE (SELECT count(*) FROM work_guests WHERE ip_day = ?) < 20 RETURNING id").bind(await auth_hash(guest), ip_day, Date.now(), ip_day).first<{ id: number }>()
            if (!guest_row) return api_error("rate_limited", "Please try again later or sign in with Google", 429)
        }
        const room = session && !owner ? await env.DB.prepare("SELECT * FROM work_rooms WHERE google_subject = ? AND revoked = 0 AND owner_wrap IS NOT NULL").bind(session.subject).first<Room>() : null
        const guest_room = guest_row ? await env.DB.prepare("SELECT * FROM work_rooms WHERE guest_id = ? AND google_subject IS NULL AND revoked = 0").bind(guest_row.id).first<Room>() : null
        const response = reply({ csrf: session?.csrf ?? await auth_hash(`guest-csrf\n${guest}`), owner_email: env.WORK_OWNER_EMAIL ?? "jason@jasouza.com", owner_key: owner_key ? { key_id: owner_key.key_id, public_jwk: JSON.parse(owner_key.public_jwk) } : null, room: room ? room_info(room) : null, guest_room: guest_room ? room_info(guest_room) : null })
        if (!session) response.headers.set("set-cookie", `${guest_cookie}=${guest}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000`)
        return response
    }
    if (!session && !guest_row) return api_error("unauthorized", "Refresh the messaging window", 401)
    if (request.method === "POST" && (session ? !valid_csrf(request, session) : request.headers.get("x-jazu-csrf") !== await auth_hash(`guest-csrf\n${guest}`))) return api_error("forbidden", "Refresh the messaging window", 403)
    if (url.pathname === "/api/v1/work/unstored-key" && request.method === "POST") {
        let data: Record<string, unknown>
        try { data = await read_json(request) } catch { return api_error("invalid_request", "Invalid recovery storage request", 400) }
        return unstored_route(request, env, session, guest_row?.id, data, dependencies.fetch)
    }
    if (url.pathname === "/api/v1/work/key-file") {
        if (!session) return api_error("forbidden", "Sign in to use private Google Drive storage", 403)
        if (request.method === "POST") {
            try {
                const data = await read_json(request)
                if (typeof data.file_id !== "string" || !/^[A-Za-z0-9_-]{10,200}$/.test(data.file_id)) throw new Error("Invalid file id")
                await env.DB.prepare("INSERT OR IGNORE INTO work_key_files (subject, file_id) VALUES (?, ?)").bind(session.subject, data.file_id).run()
            } catch { return api_error("invalid_request", "Invalid private key file", 400) }
        }
        return reply({ file_id: (await env.DB.prepare("SELECT file_id FROM work_key_files WHERE subject = ?").bind(session.subject).first<{ file_id: string }>())?.file_id ?? null })
    }
    if (url.pathname === "/api/v1/work/owner-key" && request.method === "POST") {
        if (!owner) return api_error("forbidden", "Owner access required", 403)
        try {
            const data = await read_json(request)
            const jwk = await public_key(data.public_jwk)
            const serialized = JSON.stringify(jwk), key_id = await auth_hash(serialized)
            if (owner_key && owner_key.key_id !== key_id) return api_error("owner_key_exists", "Restore the owner's existing private key from Google Drive; replacing it would lose access to messages", 409)
            await env.DB.prepare("INSERT OR IGNORE INTO work_owner_keys (id, subject, key_id, public_jwk, created_at) VALUES (1, ?, ?, ?, ?)").bind(session!.subject, key_id, serialized, Date.now()).run()
            const stored = await env.DB.prepare("SELECT key_id FROM work_owner_keys WHERE id = 1").first<{ key_id: string }>()
            return stored?.key_id === key_id ? reply({ key_id }) : api_error("owner_key_exists", "An owner key already exists", 409)
        } catch { return api_error("invalid_key", "Invalid owner public key", 400) }
    }
    if (url.pathname === base) {
        if (request.method === "GET") {
            if (!owner) return api_error("forbidden", "Owner access required", 403)
            const limit = 100
            const before = url.searchParams.get("before") ?? `${Date.now() + 1}.ffffffff-ffff-ffff-ffff-ffffffffffff`
            if (!/^\d{1,15}\.[0-9a-f-]{36}$/i.test(before)) return api_error("bad_cursor", "Invalid conversation cursor", 400)
            const [time, id] = before.split(".")
            const { results } = await env.DB.prepare("SELECT work_rooms.*, (SELECT name FROM auth_users WHERE subject = work_rooms.google_subject) AS name, (SELECT email FROM auth_users WHERE subject = work_rooms.google_subject) AS account_email, (SELECT picture FROM auth_profiles WHERE subject = work_rooms.google_subject) AS picture FROM work_rooms WHERE (created_at < ? OR (created_at = ? AND id < ?)) AND owner_wrap IS NOT NULL AND EXISTS (SELECT 1 FROM work_messages WHERE room_id = work_rooms.id) ORDER BY created_at DESC, id DESC LIMIT ?").bind(Number(time), Number(time), id, limit).all<Room>()
            const last = results[results.length - 1]
            return reply({ rooms: results.map(room_info), next: results.length === limit ? `${last.created_at}.${last.id}` : null })
        }
        if (owner) return api_error("forbidden", "Open a client from the Clients panel", 403)
        if (!owner_key) return api_error("owner_not_ready", "The owner is setting up encrypted messaging. Please try again shortly.", 503)
        try {
            const data = await read_json(request)
            if (typeof data.id !== "string" || !uuid.test(data.id) || data.key_id !== owner_key.key_id) return api_error("invalid_key", "Refresh the owner's encryption key", 400)
            const wrap = data.owner_wrap as { v: number, iv: string, ciphertext: string, public_jwk: unknown }
            if (!wrap || wrap.v !== 1 || decode_key(wrap.iv).length !== 12 || decode_key(wrap.ciphertext).length !== 48) return api_error("invalid_key", "Invalid encrypted conversation key", 400)
            const serialized = JSON.stringify({ v: 1, public_jwk: await public_key(wrap.public_jwk), iv: wrap.iv, ciphertext: wrap.ciphertext })
            const existing = session ? await env.DB.prepare("SELECT * FROM work_rooms WHERE google_subject = ? AND revoked = 0 AND owner_wrap IS NOT NULL").bind(session.subject).first<Room>() : await env.DB.prepare("SELECT * FROM work_rooms WHERE guest_id = ?").bind(guest_row!.id).first<Room>()
            if (existing) return existing.id === data.id && existing.owner_wrap === serialized ? reply({ room: room_info(existing) }) : api_error("conversation_exists", "A conversation already exists; restore its key", 409)
            await env.DB.prepare("INSERT OR IGNORE INTO work_rooms (id, email, token_hash, created_at, google_subject, guest_id, owner_wrap, owner_key_id) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM unstored_keys WHERE subject = ? AND room_id != ?)").bind(data.id, session?.email ?? `guest/${guest_row!.id}`, `disabled:${data.id}`, Date.now(), session?.subject ?? null, session ? null : guest_row!.id, serialized, owner_key.key_id, session?.subject ?? "", data.id).run()
            const room = await env.DB.prepare("SELECT * FROM work_rooms WHERE id = ?").bind(data.id).first<Room>()
            const permitted = room && (session ? room.google_subject === session.subject : !room.google_subject && room.guest_id === guest_row!.id)
            return permitted && room.owner_wrap === serialized ? reply({ room: room_info(room) }, 201) : api_error("conversation_exists", "A conversation already exists; refresh the window", 409)
        } catch { return api_error("invalid_request", "Could not start the conversation", 400) }
    }
    const match = /^\/api\/v1\/work\/rooms\/([^/]+)(\/messages|\/bind)?$/.exec(url.pathname)
    if (!match || !uuid.test(match[1])) return api_error("not_found", "Unknown workspace route", 404)
    const room = await env.DB.prepare("SELECT * FROM work_rooms WHERE id = ?").bind(match[1]).first<Room>()
    const client_access = room && !room.revoked && (room.google_subject ? room.google_subject === session?.subject : Boolean(guest_row && room.guest_id === guest_row.id))
    if (!room || (!owner && !client_access)) return api_error("not_found", "Conversation is unavailable", 404)
    if (match[2] === "/bind" && request.method === "POST") {
        if (!session || owner || !guest_row || room.guest_id !== guest_row.id || room.revoked) return api_error("forbidden", "Use the guest's browser to connect this conversation", 403)
        const linked = await env.DB.prepare("UPDATE work_rooms SET google_subject = ?, email = ? WHERE id = ? AND (google_subject IS NULL OR google_subject = ?) AND NOT EXISTS (SELECT 1 FROM work_rooms WHERE google_subject = ? AND id != ? AND revoked = 0 AND owner_wrap IS NOT NULL) AND NOT EXISTS (SELECT 1 FROM unstored_keys WHERE subject = ? AND room_id != ?) RETURNING id").bind(session.subject, session.email, room.id, session.subject, session.subject, room.id, session.subject, room.id).first()
        return linked ? reply({ linked: true }) : api_error("conversation_exists", "Your Google account already has a conversation. Guest messages were not transferred.", 409)
    }
    if (!match[2] && request.method === "GET") return reply({ room: room_info(room), role: owner ? "owner" : "client", owner_email: env.WORK_OWNER_EMAIL ?? "jason@jasouza.com" })
    if (match[2] !== "/messages") return api_error("not_found", "Unknown workspace route", 404)
    if (request.method === "GET") {
        const after = url.searchParams.get("after") ?? "0"
        if (!/^\d{1,15}$/.test(after)) return api_error("bad_cursor", "Invalid message cursor", 400)
        const { results } = await env.DB.prepare("SELECT seq, id, author, envelope, created_at FROM work_messages WHERE room_id = ? AND seq > ? ORDER BY seq LIMIT 100").bind(room.id, Number(after)).all<Work_Message>()
        return reply({ messages: results.map(row => ({ ...row, envelope: JSON.parse(row.envelope) })), more: results.length === 100 })
    }
    if (room.revoked) return api_error("revoked", "This conversation has been closed", 403)
    try {
        const data = await read_json(request)
        if (typeof data.id !== "string" || !uuid.test(data.id) || !valid_envelope(data.envelope) || Object.keys(data).sort().join(",") !== "envelope,id") return api_error("invalid_message", "Expected an encrypted message envelope", 400)
        const author = owner ? "owner" : "client"
        const envelope = JSON.stringify(data.envelope)
        const prior = await env.DB.prepare("SELECT seq, id, author, envelope, created_at FROM work_messages WHERE room_id = ? AND id = ?").bind(room.id, data.id).first<Work_Message>()
        if (prior) return prior.author === author && prior.envelope === envelope ? reply({ message: { ...prior, envelope: JSON.parse(prior.envelope) } }) : api_error("id_conflict", "This message id is already in use", 409)
        const now = Date.now()
        // The insertion enforces the burst limit in the same statement, including concurrent sends.
        await env.DB.prepare("INSERT INTO work_messages (room_id, id, author, envelope, created_at) SELECT ?, ?, ?, ?, ? WHERE (SELECT count(*) FROM work_messages WHERE room_id = ? AND author = ? AND created_at > ?) < 30 ON CONFLICT(room_id, id) DO NOTHING").bind(room.id, data.id, author, envelope, now, room.id, author, now - 60000).run()
        const row = await env.DB.prepare("SELECT seq, id, author, envelope, created_at FROM work_messages WHERE room_id = ? AND id = ?").bind(room.id, data.id).first<Work_Message>()
        if (!row) return api_error("rate_limited", "Please wait a minute before sending more messages", 429)
        if (row.author !== author || row.envelope !== envelope) return api_error("id_conflict", "This message id is already in use", 409)
        return reply({ message: { ...row, envelope: JSON.parse(row.envelope) } }, 201)
    } catch { return api_error("invalid_request", "Expected a valid encrypted message", 400) }
}
