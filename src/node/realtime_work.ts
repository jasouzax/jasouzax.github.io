/* Work authorization/delivery adapter. The socket hub itself routes generic channels and identities. */
import { work_route, type Work_Env, type Work_Message } from "./work.ts"
import type { Auth_Session } from "./auth.ts"
import { realtime_call } from "./realtime_bus.ts"
export type Realtime_Actor = { session: Auth_Session | null, guest_id: number | null, csrf: string }
type Room = { id: string, google_subject: string | null, guest_id: number | null, email: string, revoked: number }
export async function work_peers(env: Work_Env, conversation: string) {
    const room = await env.DB!.prepare("SELECT id, google_subject, guest_id, email, revoked FROM work_rooms WHERE id = ? AND owner_wrap IS NOT NULL").bind(conversation).first<Room>()
    const owner = await env.DB!.prepare("SELECT subject FROM auth_owner WHERE id = 1").first<{ subject: string }>()
    if (!room || !owner) throw new Error("Conversation unavailable")
    return { room, owner: `a:${owner.subject}`, client: room.google_subject ? `a:${room.google_subject}` : `g:${room.guest_id}` }
}
export async function work_access(env: Work_Env, actor: Realtime_Actor, conversation: string, origin: string) {
    if (conversation === "owner" && actor.session?.role !== "owner") {
        const owner = await env.DB!.prepare("SELECT subject FROM auth_owner WHERE id = 1").first<{ subject: string }>()
        if (!owner) throw new Error("The owner has not connected yet")
        return { target: `a:${owner.subject}` }
    }
    if (!/^[a-f0-9-]{36}$/i.test(conversation)) throw new Error("Invalid conversation")
    const response = await work_route(new Request(`${origin}/api/v1/work/rooms/${conversation}`), env, { actor })
    if (!response.ok) throw new Error("Conversation unavailable")
    const peers = await work_peers(env, conversation)
    return { ...peers, target: actor.session?.role === "owner" ? peers.client : peers.owner }
}
export async function work_outbox(env: Work_Env, conversation: string, id: string, source: string) {
    const peers = await work_peers(env, conversation)
    return [peers.owner, peers.client].map(target => env.DB!.prepare("INSERT OR IGNORE INTO realtime_outbox (id, source, target, payload, created_at) SELECT id || ':' || ?, ?, ?, ?, created_at FROM work_messages WHERE room_id = ? AND id = ?").bind(target, source, target, JSON.stringify({ type: "conversation-message", channel: "work", conversation, message_id: id, source }), conversation, id))
}
export async function wake_delivery(env: Work_Env, source: string, dispatch?: () => Promise<void>): Promise<void> {
    if (!env.REALTIME) return
    try { if (dispatch) await dispatch(); else await realtime_call(env, source, "drain", {}) } catch { /* The source object's alarm retries its durable outbox. */ }
}
export async function work_changed(env: Work_Env, conversation: string, subject: string): Promise<void> {
    if (!env.REALTIME) return
    const peers = await work_peers(env, conversation), source = `a:${subject}`
    await env.DB!.prepare("INSERT INTO realtime_outbox (id, source, target, payload, created_at) VALUES (?, ?, ?, ?, ?)").bind(crypto.randomUUID(), source, peers.owner, JSON.stringify({ type: "conversation-updated", channel: "work", conversation, source }), Date.now()).run()
    await wake_delivery(env, source)
}
export async function work_notification(env: Work_Env, principal: string, data: any) {
    const peers = await work_peers(env, data.conversation)
    if (![peers.owner, peers.client].includes(principal) || (peers.room.revoked && principal !== peers.owner)) return null
    const message = await env.DB!.prepare("SELECT seq, id, author, created_at FROM work_messages WHERE room_id = ? AND id = ?").bind(data.conversation, data.message_id).first<Omit<Work_Message, "envelope">>()
    if (!message) return null
    const client = peers.room.google_subject ? await env.DB!.prepare("SELECT name, email FROM auth_users WHERE subject = ?").bind(peers.room.google_subject).first<{ name: string, email: string }>() : null
    const address = principal === peers.owner ? client?.email ?? `guest/${peers.room.guest_id}` : env.WORK_OWNER_EMAIL ?? "jason@jasouza.com"
    return { type: "notification", channel: "work", conversation: data.conversation, id: message.id, seq: message.seq, created_at: message.created_at, self: data.source === principal, address, sender: message.author === "owner" ? env.WORK_OWNER_EMAIL ?? "jason@jasouza.com" : client?.name ?? `Guest ${peers.room.guest_id}` }
}
