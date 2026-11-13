/*
 * Encrypted Work API backed by D1, independent of the personal server.
 * Owner bearer secret provisions rooms; per-room random invitation tokens authenticate clients.
 * Only token hashes and authenticated ciphertext are stored. Encryption keys never enter this API.
 */
import { api_error } from "./security.ts"
import { decode_key, type Work_Envelope } from "../work_crypto.ts"
import { read_session, valid_csrf } from "./auth.ts"

export type Work_Statement = {
    bind(...values: unknown[]): Work_Statement
    first<T>(): Promise<T | null>
    all<T>(): Promise<{ results: T[] }>
    run(): Promise<unknown>
}
export type Work_Env = {
    DB?: { prepare(sql: string): Work_Statement }
    WORK_OWNER_TOKEN?: string
    WORK_OWNER_EMAIL?: string
    GOOGLE_CLIENT_ID?: string
    GOOGLE_CLIENT_SECRET?: string
    GOOGLE_ADMIN_EMAIL?: string
}
type Room = { id: string, email: string, token_hash: string, created_at: number, revoked: number, google_subject?: string | null }
export type Work_Message = { seq: number, id: string, author: "owner" | "client", envelope: string, created_at: number }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const reply = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" } })

async function token_hash(value: string): Promise<string> {
    return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, "0")).join("")
}

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

export async function work_route(request: Request, env: Work_Env): Promise<Response> {
    if (!env.DB || (!(env.WORK_OWNER_TOKEN && env.WORK_OWNER_TOKEN.length >= 32) && !env.GOOGLE_CLIENT_ID)) return api_error("work_unconfigured", "Messaging is not configured yet", 503)
    const url = new URL(request.url)
    if (request.headers.has("origin") && request.headers.get("origin") !== url.origin) return api_error("forbidden", "Use the workspace on this origin", 403)
    if (!["GET", "POST"].includes(request.method)) return api_error("method_not_allowed", "Use GET or POST", 405)
    if (request.method === "POST" && request.headers.get("x-jazu-work") !== "1") return api_error("forbidden", "Missing workspace request header", 403)
    const bearer = request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9_-]{32,256})$/)?.[1]
    const session = await read_session(request, env)
    if (!bearer && !session) return api_error("unauthorized", "Sign in with Google or open your invitation", 401)
    if (request.method === "POST" && session && !valid_csrf(request, session)) return api_error("forbidden", "Refresh the workspace before making changes", 403)
    const hashed = bearer ? await token_hash(bearer) : ""
    const owner = bearer ? Boolean(env.WORK_OWNER_TOKEN && hashed === await token_hash(env.WORK_OWNER_TOKEN)) : session?.role === "owner"
    const base = "/api/v1/work/rooms"
    if (url.pathname === base) {
        if (!owner && request.method === "GET" && session && !bearer) {
            const { results } = await env.DB.prepare("SELECT id, email, created_at, revoked FROM work_rooms WHERE google_subject = ? AND revoked = 0 ORDER BY created_at DESC LIMIT 200").bind(session.subject).all()
            return reply({ rooms: results, owner_email: env.WORK_OWNER_EMAIL ?? "jason@jasouza.com" })
        }
        if (!owner) return api_error("forbidden", "Owner access required", 403)
        if (request.method === "GET") {
            const { results } = await env.DB.prepare("SELECT id, email, created_at, revoked FROM work_rooms ORDER BY created_at DESC LIMIT 200").all()
            return reply({ rooms: results, owner_email: env.WORK_OWNER_EMAIL ?? "jason@jasouza.com" })
        }
        try {
            const data = await read_json(request)
            const email = typeof data.email === "string" ? data.email.trim().toLowerCase() : ""
            if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) || email.length > 254) return api_error("bad_email", "Enter the client's email address", 400)
            if ((data.id !== undefined || data.token !== undefined) && (typeof data.id !== "string" || !uuid.test(data.id) || typeof data.token !== "string" || !/^[A-Za-z0-9_-]{32,256}$/.test(data.token))) return api_error("invalid_invitation", "Invalid invitation credentials", 400)
            const id = typeof data.id === "string" ? data.id : crypto.randomUUID()
            const token = typeof data.token === "string" ? data.token : crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "")
            const existing = await env.DB.prepare("SELECT * FROM work_rooms WHERE email = ?").bind(email).first<Room>()
            if (existing) {
                if (existing.id === id && existing.token_hash === await token_hash(token) && !existing.revoked) return reply({ room: { id, email }, token, owner_email: env.WORK_OWNER_EMAIL ?? "jason@jasouza.com" })
                return api_error("room_exists", "A conversation for this email already exists", 409)
            }
            await env.DB.prepare("INSERT INTO work_rooms (id, email, token_hash, created_at) VALUES (?, ?, ?, ?)").bind(id, email, await token_hash(token), Date.now()).run()
            return reply({ room: { id, email }, token, owner_email: env.WORK_OWNER_EMAIL ?? "jason@jasouza.com" }, 201)
        } catch { return api_error("invalid_request", "Could not create conversation; check the email and request", 400) }
    }
    const match = /^\/api\/v1\/work\/rooms\/([^/]+)(\/messages|\/revoke|\/bind)?$/.exec(url.pathname)
    if (!match || !uuid.test(match[1])) return api_error("not_found", "Unknown workspace route", 404)
    const room = await env.DB.prepare("SELECT * FROM work_rooms WHERE id = ?").bind(match[1]).first<Room>()
    const client_access = room && !room.revoked && (bearer ? room.token_hash === hashed && (!room.google_subject || room.google_subject === session?.subject) : Boolean(session && room.google_subject === session.subject))
    if (!room || (!owner && !client_access)) return api_error("not_found", "Conversation is unavailable; linked invitations require Google sign-in", 404)
    if (match[2] === "/bind" && request.method === "POST") {
        if (!session || session.role !== "client" || room.email !== session.email || !bearer || room.token_hash !== hashed || room.revoked) return api_error("forbidden", "Sign in with the Google email invited to this conversation", 403)
        const linked = await env.DB.prepare("UPDATE work_rooms SET google_subject = ? WHERE id = ? AND (google_subject IS NULL OR google_subject = ?) RETURNING id").bind(session.subject, room.id, session.subject).first()
        return linked ? reply({ linked: true }) : api_error("already_linked", "This conversation belongs to another Google account", 409)
    }
    if (match[2] === "/revoke" && request.method === "POST") {
        if (!owner) return api_error("forbidden", "Owner access required", 403)
        await env.DB.prepare("UPDATE work_rooms SET revoked = 1 WHERE id = ?").bind(room.id).run()
        return reply({ revoked: true })
    }
    if (!match[2] && request.method === "GET") return reply({ room: { id: room.id, email: room.email, revoked: room.revoked, google_bound: Boolean(room.google_subject) }, role: owner ? "owner" : "client", owner_email: env.WORK_OWNER_EMAIL ?? "jason@jasouza.com" })
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
