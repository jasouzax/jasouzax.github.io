/* Hibernating account/guest sockets, private event routing and heartbeat-derived presence. */
import { read_session, auth_hash, session_token, type Auth_Session } from "./auth.ts"
import { guest_token, type Work_Env } from "./work.ts"
import { api_error } from "./security.ts"
import { realtime_call } from "./realtime_bus.ts"
import { realtime_channels } from "./realtime_channels.ts"
import { push_deliver } from "./push.ts"

type Socket = WebSocket & { serializeAttachment(value: unknown): void, deserializeAttachment(): Attachment }
type Attachment = { principal: string, credential: string, origin: string, connected: number, activity: number, watches: Record<string, { channel: string, conversation: string, target: string, cursor: number, presence_version?: number }> }
type Presence = { online: boolean, last_online: number | null, version: number, peer_id: string }
type State = { waitUntil?(promise: Promise<unknown>): void, acceptWebSocket(ws: WebSocket): void, getWebSockets(): Socket[], setWebSocketAutoResponse(value: unknown): void, getWebSocketAutoResponseTimestamp(ws: WebSocket): Date | null, storage: { get<T>(key: string): Promise<T | undefined>, put(key: string | Record<string, unknown>, value?: unknown): Promise<void>, delete(key: string): Promise<unknown>, setAlarm(time: number): Promise<void>, deleteAlarm(): Promise<void> } }
export const heartbeat_timeout = 90000
const json = (data: unknown) => Response.json(data, { headers: { "cache-control": "no-store" } })
const encode = (value: unknown) => JSON.stringify(value)
function write(ws: WebSocket, value: unknown): boolean {
    if (ws.readyState !== 1) return false
    try { ws.send(encode(value)); return true } catch { try { ws.close(1011, "Connection lost") } catch {}; return false }
}

export async function realtime_route(request: Request, env: Work_Env): Promise<Response> {
    const origin = new URL(request.url).origin
    if (!env.DB || !env.REALTIME) return api_error("realtime_unavailable", "Live messaging is not configured", 503)
    if (request.method !== "GET" || request.headers.get("upgrade")?.toLowerCase() !== "websocket") return api_error("upgrade_required", "Use a WebSocket", 426)
    if (request.headers.get("origin") !== origin || request.headers.has("authorization")) return api_error("forbidden", "Use this site's connection", 403)
    const session = await read_session(request, env)
    const credential = await auth_hash(session ? session_token(request) : guest_token(request))
    const guest = !session && guest_token(request) ? await env.DB.prepare("SELECT id FROM work_guests WHERE cookie_hash = ? AND created_at > ? AND NOT EXISTS (SELECT 1 FROM work_rooms WHERE guest_id = work_guests.id AND (google_subject IS NOT NULL OR revoked = 1))").bind(credential, Date.now() - 365 * 86400000).first<{ id: number }>() : null
    if (!session && !guest) return api_error("unauthorized", "Open Work or sign in first", 401)
    const principal = session ? `a:${session.subject}` : `g:${guest!.id}`
    const bucket = Math.floor(Date.now() / 60000)
    const scope = await auth_hash(`${bucket}\n${request.headers.get("cf-connecting-ip") ?? "unknown"}`)
    const admitted = await env.DB.prepare("INSERT INTO realtime_limits (scope, bucket, attempts) VALUES (?, ?, 1) ON CONFLICT(scope) DO UPDATE SET attempts = attempts + 1 WHERE attempts < 40 RETURNING attempts").bind(scope, bucket).first()
    if (!admitted) return api_error("rate_limited", "Please wait before reconnecting", 429)
    await env.DB.prepare("DELETE FROM realtime_limits WHERE bucket < ?").bind(bucket - 2).run()
    const headers = new Headers({ upgrade: "websocket", "x-jazu-principal": principal, "x-jazu-credential": credential, "x-jazu-origin": origin })
    return env.REALTIME.get(env.REALTIME.idFromName(principal)).fetch(new Request("https://realtime.internal/connect", { headers }))
}

export class Realtime_Hub {
    private principal = ""
    private presence_pending: Promise<unknown> = Promise.resolve()
    private commands = new WeakMap<Socket, { pending: number, tail: Promise<void> }>()
    constructor(private ctx: State, private env: Work_Env) {
        const Pair = (globalThis as any).WebSocketRequestResponsePair
        this.ctx.setWebSocketAutoResponse(new Pair("ping", "pong"))
    }
    private async identity(request?: Request): Promise<string> {
        this.principal ||= await this.ctx.storage.get<string>("principal") ?? ""
        const name = request?.headers.get("x-jazu-principal")
        if (!this.principal && name && /^(a:.{1,255}|g:\d+)$/.test(name)) { this.principal = name; await this.ctx.storage.put("principal", name) }
        if (!this.principal || (name && name !== this.principal)) throw new Error("Invalid routing identity")
        return this.principal
    }
    private live(): Socket[] { return this.ctx.getWebSockets().filter(ws => ws.readyState === 1) }
    private last(ws: Socket): number { const a = ws.deserializeAttachment(); return Math.max(a?.connected ?? 0, a?.activity ?? 0, this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? 0) }
    private async actor(a: Attachment): Promise<{ session: Auth_Session | null, guest_id: number | null, csrf: string } | null> {
        const csrf = "internal-socket"
        if (a.principal.startsWith("g:")) {
            const guest = await this.env.DB!.prepare("SELECT id FROM work_guests WHERE cookie_hash = ? AND created_at > ? AND NOT EXISTS (SELECT 1 FROM work_rooms WHERE guest_id = work_guests.id AND (google_subject IS NOT NULL OR revoked = 1))").bind(a.credential, Date.now() - 365 * 86400000).first<{ id: number }>()
            return guest && `g:${guest.id}` === a.principal ? { session: null, guest_id: guest.id, csrf } : null
        }
        const user = await this.env.DB!.prepare("SELECT u.subject, u.email, u.name, o.subject AS owner_subject, s.last_seen FROM auth_sessions s JOIN auth_users u ON u.subject = s.subject LEFT JOIN auth_owner o ON o.subject = u.subject WHERE s.token_hash = ? AND s.last_seen > ?").bind(a.credential, Date.now() - 30 * 86400000).first<{ subject: string, email: string, name: string, owner_subject: string | null, last_seen: number }>()
        if (!user || `a:${user.subject}` !== a.principal) return null
        if (user.last_seen < Date.now() - 300000) await this.env.DB!.prepare("UPDATE auth_sessions SET last_seen = ? WHERE token_hash = ?").bind(Date.now(), a.credential).run()
        return { session: { ...user, role: user.owner_subject ? "owner" : "client", csrf }, guest_id: null, csrf }
    }
    private async snapshot(): Promise<Presence> {
        return await this.ctx.storage.get<Presence>("presence") ?? { online: false, last_online: null, version: 0, peer_id: "" }
    }
    private async presence(_online: boolean, last = Date.now()): Promise<void> {
        // Only the projection update is serialized; cross-object fanout stays outside the lock.
        const operation = this.presence_pending.then(async (): Promise<Presence | null> => {
            const previous = await this.env.DB!.prepare("SELECT last_online FROM last_signed_in WHERE principal = ?").bind(this.principal).first<{ last_online: number | null }>()
            const stored = await this.ctx.storage.get<Presence>("presence")
            const online = this.live().some(ws => Date.now() - this.last(ws) < heartbeat_timeout)
            if (!previous && !online && !stored?.online) return null
            const last_online = online ? null : previous?.last_online ?? last
            if (previous && (online ? previous.last_online === null : previous.last_online !== null) && stored?.online === online && stored.last_online === last_online) return null
            if (previous || online) await this.env.DB!.prepare("INSERT INTO last_signed_in (principal, last_online) SELECT ?, ? WHERE ? = 1 OR EXISTS (SELECT 1 FROM auth_users WHERE subject = ?) ON CONFLICT(principal) DO UPDATE SET last_online = excluded.last_online").bind(this.principal, last_online, this.principal.startsWith("g:") ? 1 : 0, this.principal.slice(2)).run()
            const value: Presence = { online, last_online, version: Math.max(Date.now(), (stored?.version ?? 0) + 1), peer_id: await auth_hash(this.principal) }
            await this.ctx.storage.put({ presence: value, presence_delivery: value })
            return value
        })
        this.presence_pending = operation.catch(() => {})
        const changed = await operation
        if (!changed) return
        const fanout = this.publish_presence(changed)
        if (this.ctx.waitUntil) this.ctx.waitUntil(fanout); else await fanout
    }
    private async publish_presence(value: Presence): Promise<void> {
        const watchers = await this.ctx.storage.get<Record<string, { principal: string, channel: string, conversation: string, revision: string }>>("watchers") ?? {}, stale: string[] = []
        let failed = false
        for (const [id, watcher] of Object.entries(watchers)) {
            try {
                const result = await realtime_call(this.env, watcher.principal, "presence-event", { ...watcher, peer: this.principal, ...value })
                if (result.status === 404) stale.push(id)
            } catch { failed = true }
        }
        if (stale.length) {
            const current = await this.ctx.storage.get<typeof watchers>("watchers") ?? {}
            for (const id of stale) if (current[id]?.revision === watchers[id].revision) delete current[id]
            await this.ctx.storage.put("watchers", current)
        }
        if (!failed && (await this.ctx.storage.get<Presence>("presence_delivery"))?.version === value.version) await this.ctx.storage.delete("presence_delivery")
        await this.schedule()
    }
    private async schedule(): Promise<void> {
        const pending = await this.pending() || Boolean(await this.ctx.storage.get("presence_delivery")), live = this.live()
        const deadline = live.length ? Math.min(...live.map(ws => this.last(ws) + heartbeat_timeout)) : Infinity
        if (live.length || pending) await this.ctx.storage.setAlarm(Math.max(Date.now() + 1000, Math.min(deadline, pending ? Date.now() + 10000 : Infinity)))
        else await this.ctx.storage.deleteAlarm()
    }
    private async sweep(disconnected_at = 0): Promise<void> {
        let last = disconnected_at || await this.ctx.storage.get<number>("last_activity") || 0
        for (const ws of this.live()) {
            last = Math.max(last, this.last(ws))
            if (Date.now() - this.last(ws) >= heartbeat_timeout) ws.close(4000, "Connection expired")
            else if (!await this.actor(ws.deserializeAttachment())) ws.close(4003, "Signed out")
        }
        if (last) await this.ctx.storage.put("last_activity", last)
        const live = this.live()
        if (!live.length) await this.presence(false, last || Date.now())
        else await this.presence(true)
        await this.schedule()
    }
    async fetch(request: Request): Promise<Response> {
        await this.identity(request)
        const action = new URL(request.url).pathname
        if (action === "/connect") {
            await this.sweep()
            const attachment: Attachment = { principal: this.principal, credential: request.headers.get("x-jazu-credential")!, origin: request.headers.get("x-jazu-origin")!, connected: Date.now(), activity: Date.now(), watches: {} }
            if (!await this.actor(attachment)) return new Response("Session expired", { status: 401 })
            if (this.principal.startsWith("g:")) for (const ws of this.live()) ws.close(4001, "Connected in another tab")
            else if (this.live().length >= 8) return new Response("Too many active tabs", { status: 429 })
            const pair = new (globalThis as any).WebSocketPair(), client = pair[0], server = pair[1] as Socket
            this.ctx.acceptWebSocket(server)
            server.serializeAttachment(attachment)
            await this.presence(true); await this.schedule()
            write(server, { type: "ready", heartbeat: 30000 })
            return new Response(null, { status: 101, webSocket: client } as ResponseInit)
        }
        const data = await request.json() as any
        if (action === "/revoke") {
            for (const ws of this.live()) if (!data.credential || ws.deserializeAttachment().credential === data.credential) ws.close(4003, "Signed out")
            await this.sweep(Date.now()); return json({ ok: true })
        }
        if (action === "/presence") {
            await this.sweep()
            return json(await this.snapshot())
        }
        return this.internal(action, data)
    }
    private async pending(): Promise<boolean> {
        return Boolean(await this.env.DB!.prepare("SELECT 1 FROM realtime_outbox WHERE source = ? LIMIT 1").bind(this.principal).first())
    }
    private async drain(): Promise<void> {
        const { results } = await this.env.DB!.prepare("SELECT id, target, payload FROM realtime_outbox WHERE source = ? ORDER BY created_at, id LIMIT 100").bind(this.principal).all<{ id: string, target: string, payload: string }>()
        for (const row of results) {
            try {
                const data = JSON.parse(row.payload)
                const response = row.target === this.principal ? await this.internal("/event", data) : await realtime_call(this.env, row.target, "event", data)
                if (response.ok) await this.env.DB!.prepare("DELETE FROM realtime_outbox WHERE id = ?").bind(row.id).run()
            } catch { /* Keep the atomic D1 outbox record for the next alarm/reconnect. */ }
        }
        if (await this.pending()) await this.ctx.storage.setAlarm(Date.now() + 10000)
    }
    private async sync(ws: Socket, key: string): Promise<void> {
        let watch = ws.deserializeAttachment().watches[key]
        if (!watch) return
        for (let page = 0; page < 10; page++) {
            const results = await realtime_channels.get(watch.channel)!.history(this.env, watch.conversation, watch.cursor)
            const current = ws.deserializeAttachment(), latest = current.watches[key]
            if (!latest || ws.readyState !== 1) return
            const messages = results.filter(row => row.seq > latest.cursor)
            if (messages.length) {
                if (!write(ws, { type: "messages", channel: watch.channel, conversation: watch.conversation, messages })) return
                latest.cursor = Math.max(latest.cursor, messages[messages.length - 1].seq); ws.serializeAttachment(current)
            }
            watch = latest
            if (results.length < 100) return
        }
        write(ws, { type: "catchup", channel: watch.channel, conversation: watch.conversation })
    }
    protected async internal(action: string, data: any): Promise<Response> {
        if (action === "/drain") { await this.drain(); return json({ ok: true }) }
        if (action === "/subscribe" || action === "/unsubscribe") {
            const watchers = await this.ctx.storage.get<Record<string, any>>("watchers") ?? {}, key = `${data.principal}:${data.channel}:${data.conversation}`
            if (action === "/unsubscribe") delete watchers[key]
            else {
                if (!watchers[key] && Object.keys(watchers).length >= 512) return new Response("Too many subscriptions", { status: 429 })
                watchers[key] = { principal: data.principal, channel: data.channel, conversation: data.conversation, revision: crypto.randomUUID() }
            }
            await this.ctx.storage.put("watchers", watchers); await this.sweep()
            return json(await this.snapshot())
        }
        if (action === "/presence-event") {
            let delivered = false
            for (const ws of this.live()) {
                const watch = ws.deserializeAttachment().watches[`${data.channel}:${data.conversation}`]
                if (watch?.target === data.peer) {
                    delivered = true
                    if ((data.version ?? 0) < (watch.presence_version ?? 0)) continue
                    const current = ws.deserializeAttachment(); current.watches[`${data.channel}:${data.conversation}`].presence_version = data.version ?? 0; ws.serializeAttachment(current)
                    write(ws, { type: "presence", channel: data.channel, conversation: data.conversation, online: data.online, last_online: data.last_online, version: data.version ?? 0, peer_id: data.peer_id ?? "" })
                }
            }
            return new Response(null, { status: delivered ? 204 : 404 })
        }
        if (action === "/event" && realtime_channels.has(data.channel)) {
            const channel = realtime_channels.get(data.channel)!
            if (data.type === "conversation-updated") {
                const changed = await channel.changed(this.env, this.principal, data)
                if (changed) for (const ws of this.live()) write(ws, changed)
                return json({ ok: true })
            }
            const notification = await channel.notification(this.env, this.principal, data)
            if (!notification) return json({ ignored: true })
            for (const ws of this.live()) {
                if (!await this.actor(ws.deserializeAttachment())) { ws.close(4003, "Signed out"); continue }
                if (!write(ws, notification)) continue
                if (ws.deserializeAttachment().watches[`${data.channel}:${data.conversation}`]) await this.sync(ws, `${data.channel}:${data.conversation}`)
            }
            await push_deliver(this.env, this.principal, notification)
            return json({ ok: true })
        }
        return new Response("Unknown action", { status: 404 })
    }
    async webSocketMessage(ws: Socket, message: string | ArrayBuffer): Promise<void> {
        if (typeof message !== "string" || message.length > 12000 || new TextEncoder().encode(message).length > 12000) { ws.close(1009, "Message too large"); return }
        const queue = this.commands.get(ws) ?? { pending: 0, tail: Promise.resolve() }
        if (queue.pending >= 64) { ws.close(1008, "Too many queued requests"); return }
        queue.pending++; this.commands.set(ws, queue)
        const task = queue.tail.catch(() => {}).then(() => this.consume_message(ws, message))
        queue.tail = task
        try { await task } finally { if (--queue.pending === 0) this.commands.delete(ws) }
    }
    private async consume_message(ws: Socket, message: string): Promise<void> {
        if (ws.readyState !== 1) return
        await this.identity()
        const bucket = Math.floor(Date.now() / 60000), rate = await this.ctx.storage.get<{ bucket: number, count: number }>("rate")
        const count = rate?.bucket === bucket ? rate.count + 1 : 1
        await this.ctx.storage.put("rate", { bucket, count })
        if (count > (this.principal.startsWith("g:") ? 60 : 120)) { ws.close(1008, "Too many requests"); return }
        let attachment = ws.deserializeAttachment()
        if (!await this.actor(attachment)) { ws.close(4003, "Signed out"); await this.sweep(); return }
        attachment = ws.deserializeAttachment()
        attachment.activity = Date.now(); ws.serializeAttachment(attachment)
        try { await this.command(ws, JSON.parse(message), attachment) }
        catch { write(ws, { type: "error", error: "Invalid live message" }) }
    }
    protected async command(ws: Socket, data: any, attachment: Attachment): Promise<void> {
        const ack = (result?: unknown, error?: string) => write(ws, { type: "ack", request_id: data.request_id, result, error })
        if (typeof data.request_id !== "string" || data.request_id.length > 64 || !realtime_channels.has(data.channel)) { ack(undefined, "Unknown channel"); return }
        const actor = await this.actor(attachment)
        if (!actor) { ws.close(4003, "Signed out"); return }
        try {
            const channel = realtime_channels.get(data.channel)!, key = `${data.channel}:${data.conversation}`
            if (data.type === "watch") {
                if (!Number.isSafeInteger(data.after) || data.after < 0) throw new Error("Invalid cursor")
                const peers = await channel.authorize(this.env, actor, data.conversation, attachment.origin)
                if (!attachment.watches[key] && Object.keys(attachment.watches).length >= 32) throw new Error("Too many conversations")
                attachment = ws.deserializeAttachment()
                attachment.watches[key] = { channel: data.channel, conversation: data.conversation, target: peers.target ?? "", cursor: Math.min(attachment.watches[key]?.cursor ?? data.after, data.after), presence_version: attachment.watches[key]?.target === peers.target ? attachment.watches[key]?.presence_version ?? 0 : 0 }; ws.serializeAttachment(attachment)
                const response = peers.target ? await realtime_call(this.env, peers.target, "subscribe", { principal: this.principal, channel: data.channel, conversation: data.conversation }) : json({ online: false, last_online: null })
                if (!response.ok) throw new Error("Presence subscription unavailable")
                const presence = await response.json() as Presence, current = ws.deserializeAttachment()
                if (current.watches[key]) { current.watches[key].presence_version = Math.max(current.watches[key].presence_version ?? 0, presence.version ?? 0); ws.serializeAttachment(current) }
                ack({ presence }); await this.sync(ws, key); return
            }
            if (data.type === "unwatch") {
                const watch = attachment.watches[key]; delete attachment.watches[key]; ws.serializeAttachment(attachment)
                if (watch?.target && !this.live().some(other => other.deserializeAttachment().watches[key])) await realtime_call(this.env, watch.target, "unsubscribe", { principal: this.principal, channel: data.channel, conversation: data.conversation })
                ack({ ok: true }); return
            }
            if (data.type === "send") {
                await channel.authorize(this.env, actor, data.conversation, attachment.origin)
                const result = await channel.send(this.env, actor, attachment.origin, data, async () => {
                    // Acknowledgements depend on D1 commit, never on an external push provider's latency.
                    await this.ctx.storage.setAlarm(Date.now() + 10000)
                    const delivery = this.drain()
                    if (this.ctx.waitUntil) this.ctx.waitUntil(delivery)
                    else await delivery
                })
                ack(result.value, result.error); return
            }
            ack(undefined, "Unknown command")
        } catch (error) { ack(undefined, error instanceof Error ? error.message : "Live request failed") }
    }
    async webSocketClose(ws: Socket, _code?: number, _reason?: string, wasClean = true): Promise<void> {
        await this.identity()
        const attachment = ws.deserializeAttachment()
        for (const [key, watch] of Object.entries(attachment?.watches ?? {})) if (watch.target && !this.live().some(other => other.deserializeAttachment().watches[key])) try { await realtime_call(this.env, watch.target, "unsubscribe", { principal: this.principal, channel: watch.channel, conversation: watch.conversation }) } catch {}
        await this.sweep(wasClean ? Date.now() : this.last(ws))
    }
    async webSocketError(ws: Socket): Promise<void> { ws.close(1011, "Connection error"); await this.identity(); await this.sweep() }
    async alarm(): Promise<void> { await this.identity(); await this.sweep(); await this.drain(); const presence = await this.ctx.storage.get<Presence>("presence_delivery"); if (presence) await this.publish_presence(presence) }
}
