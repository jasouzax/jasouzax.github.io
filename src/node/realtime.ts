/* Hibernating account/guest sockets, private event routing and heartbeat-derived presence. */
import { read_session, auth_hash, session_token, type Auth_Session } from "./auth.ts"
import { guest_token, type Work_Env } from "./work.ts"
import { api_error } from "./security.ts"
import { realtime_call } from "./realtime_bus.ts"
import { realtime_channels } from "./realtime_channels.ts"

type Socket = WebSocket & { serializeAttachment(value: unknown): void, deserializeAttachment(): Attachment }
type Attachment = { principal: string, credential: string, origin: string, connected: number, activity: number, watches: Record<string, { channel: string, conversation: string, target: string, cursor: number }> }
type State = { acceptWebSocket(ws: WebSocket): void, getWebSockets(): Socket[], setWebSocketAutoResponse(value: unknown): void, getWebSocketAutoResponseTimestamp(ws: WebSocket): Date | null, storage: { get<T>(key: string): Promise<T | undefined>, put(key: string, value: unknown): Promise<void>, setAlarm(time: number): Promise<void>, deleteAlarm(): Promise<void> } }
export const heartbeat_timeout = 90000
const json = (data: unknown) => Response.json(data, { headers: { "cache-control": "no-store" } })
const encode = (value: unknown) => JSON.stringify(value)

export async function realtime_route(request: Request, env: Work_Env): Promise<Response> {
    const origin = new URL(request.url).origin
    if (!env.DB || !env.REALTIME) return api_error("realtime_unavailable", "Live messaging is not configured", 503)
    if (request.method !== "GET" || request.headers.get("upgrade")?.toLowerCase() !== "websocket") return api_error("upgrade_required", "Use a WebSocket", 426)
    if (request.headers.get("origin") !== origin || request.headers.has("authorization")) return api_error("forbidden", "Use this site's connection", 403)
    const session = await read_session(request, env)
    const credential = await auth_hash(session ? session_token(request) : guest_token(request))
    const guest = !session && guest_token(request) ? await env.DB.prepare("SELECT id FROM work_guests WHERE cookie_hash = ? AND created_at > ?").bind(credential, Date.now() - 365 * 86400000).first<{ id: number }>() : null
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
            const guest = await this.env.DB!.prepare("SELECT id FROM work_guests WHERE cookie_hash = ? AND created_at > ?").bind(a.credential, Date.now() - 365 * 86400000).first<{ id: number }>()
            return guest && `g:${guest.id}` === a.principal ? { session: null, guest_id: guest.id, csrf } : null
        }
        const user = await this.env.DB!.prepare("SELECT u.subject, u.email, u.name, o.subject AS owner_subject, s.last_seen FROM auth_sessions s JOIN auth_users u ON u.subject = s.subject LEFT JOIN auth_owner o ON o.subject = u.subject WHERE s.token_hash = ? AND s.last_seen > ?").bind(a.credential, Date.now() - 30 * 86400000).first<{ subject: string, email: string, name: string, owner_subject: string | null, last_seen: number }>()
        if (!user || `a:${user.subject}` !== a.principal) return null
        if (user.last_seen < Date.now() - 300000) await this.env.DB!.prepare("UPDATE auth_sessions SET last_seen = ? WHERE token_hash = ?").bind(Date.now(), a.credential).run()
        return { session: { ...user, role: user.owner_subject ? "owner" : "client", csrf }, guest_id: null, csrf }
    }
    private async presence(online: boolean, last = Date.now(), force = false): Promise<void> {
        const previous = await this.env.DB!.prepare("SELECT last_online FROM last_signed_in WHERE principal = ?").bind(this.principal).first<{ last_online: number | null }>()
        if (!previous && !online && !force) return
        if (!force && previous && (online ? previous.last_online === null : previous.last_online !== null)) return
        if (previous || online) await this.env.DB!.prepare("INSERT INTO last_signed_in (principal, last_online) VALUES (?, ?) ON CONFLICT(principal) DO UPDATE SET last_online = excluded.last_online").bind(this.principal, online ? null : last).run()
        const watchers = await this.ctx.storage.get<Record<string, { principal: string, channel: string, conversation: string, revision: string }>>("watchers") ?? {}, stale: string[] = []
        for (const [id, watcher] of Object.entries(watchers)) {
            try {
                const result = await realtime_call(this.env, watcher.principal, "presence-event", { ...watcher, peer: this.principal, online, last_online: online ? null : last })
                if (result.status === 404) stale.push(id)
            } catch { /* A reconnect obtains an authoritative presence snapshot. */ }
        }
        if (stale.length) {
            const current = await this.ctx.storage.get<typeof watchers>("watchers") ?? {}
            for (const id of stale) if (current[id]?.revision === watchers[id].revision) delete current[id]
            await this.ctx.storage.put("watchers", current)
        }
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
        if (live.length) await this.ctx.storage.setAlarm(Math.max(Date.now() + 1000, Math.min(...live.map(ws => this.last(ws) + heartbeat_timeout))))
        else if (await this.pending()) await this.ctx.storage.setAlarm(Date.now() + 10000)
        else await this.ctx.storage.deleteAlarm()
    }
    async fetch(request: Request): Promise<Response> {
        await this.identity(request)
        const action = new URL(request.url).pathname
        if (action === "/connect") {
            await this.sweep()
            if (this.principal.startsWith("g:")) for (const ws of this.live()) ws.close(4001, "Connected in another tab")
            else if (this.live().length >= 8) return new Response("Too many active tabs", { status: 429 })
            const pair = new (globalThis as any).WebSocketPair(), client = pair[0], server = pair[1] as Socket
            this.ctx.acceptWebSocket(server)
            server.serializeAttachment({ principal: this.principal, credential: request.headers.get("x-jazu-credential")!, origin: request.headers.get("x-jazu-origin")!, connected: Date.now(), activity: Date.now(), watches: {} } satisfies Attachment)
            await this.presence(true); await this.ctx.storage.setAlarm(Date.now() + heartbeat_timeout)
            server.send(encode({ type: "ready", heartbeat: 30000 }))
            return new Response(null, { status: 101, webSocket: client } as ResponseInit)
        }
        const data = await request.json() as any
        if (action === "/revoke") {
            for (const ws of this.live()) if (!data.credential || ws.deserializeAttachment().credential === data.credential) ws.close(4003, "Signed out")
            await this.sweep(Date.now()); if (!this.live().length) await this.presence(false, Date.now(), true); return json({ ok: true })
        }
        if (action === "/presence") {
            await this.sweep()
            const row = await this.env.DB!.prepare("SELECT last_online FROM last_signed_in WHERE principal = ?").bind(this.principal).first<{ last_online: number | null }>()
            return json({ online: row?.last_online === null, last_online: row?.last_online ?? null })
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
                ws.send(encode({ type: "messages", channel: watch.channel, conversation: watch.conversation, messages }))
                latest.cursor = Math.max(latest.cursor, messages[messages.length - 1].seq); ws.serializeAttachment(current)
            }
            watch = latest
            if (results.length < 100) return
        }
        ws.send(encode({ type: "catchup", channel: watch.channel, conversation: watch.conversation }))
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
            const row = await this.env.DB!.prepare("SELECT last_online FROM last_signed_in WHERE principal = ?").bind(this.principal).first<{ last_online: number | null }>()
            return json({ online: row?.last_online === null, last_online: row?.last_online ?? null })
        }
        if (action === "/presence-event") {
            let delivered = false
            for (const ws of this.live()) {
                const watch = ws.deserializeAttachment().watches[`${data.channel}:${data.conversation}`]
                if (watch?.target === data.peer) { ws.send(encode({ type: "presence", channel: data.channel, conversation: data.conversation, online: data.online, last_online: data.last_online })); delivered = true }
            }
            return new Response(null, { status: delivered ? 204 : 404 })
        }
        if (action === "/event" && realtime_channels.has(data.channel)) {
            const channel = realtime_channels.get(data.channel)!
            if (data.type === "conversation-updated") {
                const changed = await channel.changed(this.env, this.principal, data)
                if (changed) for (const ws of this.live()) ws.send(encode(changed))
                return json({ ok: true })
            }
            const notification = await channel.notification(this.env, this.principal, data)
            if (!notification) return json({ ignored: true })
            for (const ws of this.live()) {
                if (!await this.actor(ws.deserializeAttachment())) { ws.close(4003, "Signed out"); continue }
                ws.send(encode(notification))
                if (ws.deserializeAttachment().watches[`${data.channel}:${data.conversation}`]) await this.sync(ws, `${data.channel}:${data.conversation}`)
            }
            return json({ ok: true })
        }
        return new Response("Unknown action", { status: 404 })
    }
    async webSocketMessage(ws: Socket, message: string | ArrayBuffer): Promise<void> {
        await this.identity()
        if (typeof message !== "string" || new TextEncoder().encode(message).length > 12000) { ws.close(1009, "Message too large"); return }
        const bucket = Math.floor(Date.now() / 60000), rate = await this.ctx.storage.get<{ bucket: number, count: number }>("rate")
        const count = rate?.bucket === bucket ? rate.count + 1 : 1
        await this.ctx.storage.put("rate", { bucket, count })
        if (count > (this.principal.startsWith("g:") ? 60 : 120)) { ws.close(1008, "Too many requests"); return }
        const attachment = ws.deserializeAttachment()
        if (!await this.actor(attachment)) { ws.close(4003, "Signed out"); await this.sweep(); return }
        attachment.activity = Date.now(); ws.serializeAttachment(attachment)
        try { await this.command(ws, JSON.parse(message), attachment) }
        catch { ws.send(encode({ type: "error", error: "Invalid live message" })) }
    }
    protected async command(ws: Socket, data: any, attachment: Attachment): Promise<void> {
        const ack = (result?: unknown, error?: string) => ws.send(encode({ type: "ack", request_id: data.request_id, result, error }))
        if (typeof data.request_id !== "string" || data.request_id.length > 64 || !realtime_channels.has(data.channel)) { ack(undefined, "Unknown channel"); return }
        const actor = await this.actor(attachment)
        if (!actor) { ws.close(4003, "Signed out"); return }
        try {
            const channel = realtime_channels.get(data.channel)!, key = `${data.channel}:${data.conversation}`
            if (data.type === "watch") {
                if (!Number.isSafeInteger(data.after) || data.after < 0) throw new Error("Invalid cursor")
                const peers = await channel.authorize(this.env, actor, data.conversation, attachment.origin)
                if (!attachment.watches[key] && Object.keys(attachment.watches).length >= 32) throw new Error("Too many conversations")
                attachment.watches[key] = { channel: data.channel, conversation: data.conversation, target: peers.target, cursor: Math.min(attachment.watches[key]?.cursor ?? data.after, data.after) }; ws.serializeAttachment(attachment)
                const response = await realtime_call(this.env, peers.target, "subscribe", { principal: this.principal, channel: data.channel, conversation: data.conversation })
                if (!response.ok) throw new Error("Presence subscription unavailable")
                ack({ presence: await response.json() }); await this.sync(ws, key); return
            }
            if (data.type === "unwatch") {
                const watch = attachment.watches[key]; delete attachment.watches[key]; ws.serializeAttachment(attachment)
                if (watch && !this.live().some(other => other.deserializeAttachment().watches[key])) await realtime_call(this.env, watch.target, "unsubscribe", { principal: this.principal, channel: data.channel, conversation: data.conversation })
                ack({ ok: true }); return
            }
            if (data.type === "send") {
                await channel.authorize(this.env, actor, data.conversation, attachment.origin)
                const result = await channel.send(this.env, actor, attachment.origin, data, () => this.drain())
                ack(result.value, result.error); return
            }
            ack(undefined, "Unknown command")
        } catch (error) { ack(undefined, error instanceof Error ? error.message : "Live request failed") }
    }
    async webSocketClose(ws: Socket, _code?: number, _reason?: string, wasClean = true): Promise<void> {
        await this.identity()
        const attachment = ws.deserializeAttachment()
        for (const [key, watch] of Object.entries(attachment?.watches ?? {})) if (!this.live().some(other => other.deserializeAttachment().watches[key])) try { await realtime_call(this.env, watch.target, "unsubscribe", { principal: this.principal, channel: watch.channel, conversation: watch.conversation }) } catch {}
        await this.sweep(wasClean ? Date.now() : this.last(ws))
    }
    async webSocketError(ws: Socket): Promise<void> { ws.close(1011, "Connection error"); await this.identity(); await this.sweep() }
    async alarm(): Promise<void> { await this.identity(); await this.sweep(); await this.drain() }
}
