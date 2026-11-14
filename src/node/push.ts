/* Web Push wakes a closed PWA; the payload contains only routing metadata. The device fetches/decrypts ciphertext. */
import { buildPushPayload, type PushSubscription } from "@block65/webcrypto-web-push"
import { read_session, valid_csrf, session_token, auth_hash } from "./auth.ts"
import type { Work_Env, Work_Message } from "./work.ts"
import { work_access } from "./realtime_work.ts"
import { decode_key } from "../work_crypto.ts"
import { api_error } from "./security.ts"
const reply = (data: unknown) => Response.json(data, { headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" } })
export function push_endpoint(value: string): boolean {
    try {
        const url = new URL(value)
        return url.protocol === "https:" && !url.port && !url.username && !url.password && !url.hash && value.length < 2048 &&
            (url.hostname === "fcm.googleapis.com" || url.hostname === "updates.push.services.mozilla.com" || url.hostname === "web.push.apple.com" || /^[a-z0-9-]+\.notify\.windows\.com$/.test(url.hostname))
    } catch { return false }
}
export async function push_route(request: Request, env: Work_Env): Promise<Response> {
    if (!env.DB) return api_error("unavailable", "Push is unavailable", 503)
    if (request.headers.has("authorization")) return api_error("forbidden", "Use your browser session", 403)
    const session = await read_session(request, env)
    if (!session) return api_error("forbidden", "Sign in to receive notifications", 403)
    const url = new URL(request.url)
    if (request.headers.has("origin") && request.headers.get("origin") !== url.origin) return api_error("forbidden", "Use this website", 403)
    if (url.pathname === "/api/v1/push/config" && request.method === "GET") return reply({ public_key: env.VAPID_PUBLIC_KEY ?? "", enabled: Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT) })
    if (url.pathname === "/api/v1/push/message" && request.method === "GET") {
        const conversation = url.searchParams.get("conversation") ?? "", id = url.searchParams.get("id") ?? ""
        if (!/^[a-f0-9-]{36}$/i.test(conversation) || !/^[a-f0-9-]{36}$/i.test(id)) return api_error("bad_request", "Invalid notification", 400)
        try { await work_access(env, { session, guest_id: null, csrf: session.csrf }, conversation, url.origin) }
        catch { return api_error("not_found", "Notification unavailable", 404) }
        const message = await env.DB.prepare("SELECT id, author, envelope FROM work_messages WHERE room_id = ? AND id = ?").bind(conversation, id).first<Work_Message>()
        const room = await env.DB.prepare("SELECT owner_wrap FROM work_rooms WHERE id = ?").bind(conversation).first<{ owner_wrap: string | null }>()
        if (!message || !room) return api_error("not_found", "Notification unavailable", 404)
        return reply({ email: session.email, owner_wrap: room.owner_wrap ? JSON.parse(room.owner_wrap) : null, message: { id: message.id, author: message.author, envelope: JSON.parse(message.envelope) } })
    }
    if (url.pathname !== "/api/v1/push/subscription" || request.method !== "POST" || !valid_csrf(request, session)) return api_error("forbidden", "Invalid notification request", 403)
    try {
        if (Number(request.headers.get("content-length")) > 4096) throw new Error("Too large")
        const reader = request.body?.getReader(); if (!reader) throw new Error("Missing subscription")
        let text = "", size = 0
        try { while (true) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength; if (size > 4096) throw new Error("Too large"); text += new TextDecoder().decode(next.value, { stream: true }) } } finally { await reader.cancel() }
        const body = JSON.parse(text)
        const hash = await auth_hash(session_token(request))
        if (body.action === "remove") {
            await env.DB.prepare("DELETE FROM push_receipts WHERE subscription_id IN (SELECT id FROM push_subscriptions WHERE session_hash = ?)").bind(hash).run()
            await env.DB.prepare("DELETE FROM push_subscriptions WHERE session_hash = ?").bind(hash).run()
            return reply({ removed: true })
        }
        if (!env.VAPID_PRIVATE_KEY || !env.VAPID_PUBLIC_KEY) return api_error("unavailable", "Push is not configured", 503)
        const value = body.subscription as PushSubscription
        if (!value || !push_endpoint(value.endpoint) || decode_key(value.keys.auth).length !== 16 || decode_key(value.keys.p256dh).length !== 65) throw new Error("Invalid subscription")
        await crypto.subtle.importKey("raw", decode_key(value.keys.p256dh), { name: "ECDH", namedCurve: "P-256" }, false, [])
        const id = await auth_hash(value.endpoint)
        const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM push_subscriptions WHERE subject = ? AND id != ?").bind(session.subject, id).first<{ count: number }>()
        if ((count?.count ?? 0) >= 8) return api_error("too_many_devices", "Notification device limit reached", 429)
        const clean: PushSubscription = { endpoint: value.endpoint, expirationTime: null, keys: { auth: value.keys.auth, p256dh: value.keys.p256dh } }
        await env.DB.prepare("INSERT INTO push_subscriptions (id, subject, session_hash, subscription, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET subject = excluded.subject, session_hash = excluded.session_hash, subscription = excluded.subscription, updated_at = excluded.updated_at").bind(id, session.subject, hash, JSON.stringify(clean), Date.now()).run()
        return reply({ subscribed: true })
    } catch { return api_error("bad_request", "Invalid push subscription", 400) }
}
export async function push_deliver(env: Work_Env, principal: string, notice: any, upstream: typeof fetch = fetch): Promise<void> {
    if (!env.DB || !env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT || !principal.startsWith("a:") || notice.self) return
    if (notice.created_at && notice.created_at < Date.now() - 86400000) return
    const rows = (await env.DB.prepare("SELECT p.id, p.subscription FROM push_subscriptions p JOIN auth_sessions s ON s.token_hash = p.session_hash JOIN auth_users u ON u.subject = p.subject WHERE p.subject = ? AND s.subject = p.subject AND s.last_seen > ? LIMIT 8").bind(principal.slice(2), Date.now() - 30 * 86400000).all<{ id: string, subscription: string }>()).results
    let failed = false
    for (const row of rows) {
      try {
        if (await env.DB.prepare("SELECT 1 FROM push_receipts WHERE subscription_id = ? AND message_id = ?").bind(row.id, notice.id).first()) continue
        const subscription = JSON.parse(row.subscription) as PushSubscription
        if (!push_endpoint(subscription.endpoint)) continue
        const data = { channel: notice.channel, conversation: notice.conversation, id: notice.id, sender: notice.sender, href: notice.href }
        const payload = await buildPushPayload({ data, options: { ttl: 86400, urgency: "high" } }, subscription, { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY })
        const response = await upstream(subscription.endpoint, { ...payload, redirect: "manual", signal: AbortSignal.timeout(10000) })
        if (response.status === 404 || response.status === 410) {
            await env.DB.prepare("DELETE FROM push_subscriptions WHERE id = ?").bind(row.id).run()
            await env.DB.prepare("DELETE FROM push_receipts WHERE subscription_id = ?").bind(row.id).run()
        } else if (response.ok) {
            await env.DB.prepare("INSERT OR IGNORE INTO push_receipts (subscription_id, message_id, created_at) VALUES (?, ?, ?)").bind(row.id, notice.id, Date.now()).run()
        } else failed = true
      } catch { failed = true }
    }
    await env.DB.prepare("DELETE FROM push_receipts WHERE created_at < ?").bind(Date.now() - 7 * 86400000).run()
    if (failed) throw new Error("Push service temporarily unavailable")
}
