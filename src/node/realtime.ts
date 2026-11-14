/* Hibernating account/guest sockets, private event routing and heartbeat-derived presence. */
import { read_session, auth_hash, session_token, type Auth_Session } from "./auth.ts"
import { guest_token, type Work_Env } from "./work.ts"
import { api_error } from "./security.ts"
import { realtime_call } from "./realtime_bus.ts"

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
    private last(ws: Socket): number { const a = ws.deserializeAttachment(); return Math.max(a.connected, a.activity, this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? 0) }
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
    private async presence(online: boolean, last = Date.now()): Promise<void> {
        const previous = await this.env.DB!.prepare("SELECT last_online FROM last_signed_in WHERE principal = ?").bind(this.principal).first<{ last_online: number | null }>()
        if (!previous && !online) return
        if (previous && (online ? previous.last_online === null : previous.last_online !== null)) return
        await this.env.DB!.prepare("INSERT INTO last_signed_in (principal, last_online) VALUES (?, ?) ON CONFLICT(principal) DO UPDATE SET last_online = excluded.last_online").bind(this.principal, online ? null : last).run()
        const watchers = await this.ctx.storage.get<Record<string, { principal: string, channel: string, conversation: string }>>("watchers") ?? {}
        for (const [id, watcher] of Object.entries(watchers)) {
            try {
                const result = await realtime_call(this.env, watcher.principal, "presence-event", { ...watcher, online, last_online: online ? null : last })
                if (result.status === 404) delete watchers[id]
            } catch { /* A reconnect obtains an authoritative presence snapshot. */ }
        }
        await this.ctx.storage.put("watchers", watchers)
    }
    private async sweep(): Promise<void> {
        let last = 0
        for (const ws of this.live()) {
            last = Math.max(last, this.last(ws))
            if (Date.now() - this.last(ws) > heartbeat_timeout || !await this.actor(ws.deserializeAttachment())) ws.close(4000, "Connection expired")
        }
        const live = this.live()
        if (!live.length) await this.presence(false, last || Date.now())
        else await this.presence(true)
        if (live.length) await this.ctx.storage.setAlarm(Date.now() + heartbeat_timeout)
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
            await this.sweep(); return json({ ok: true })
        }
        if (action === "/presence") {
            await this.sweep()
            const row = await this.env.DB!.prepare("SELECT last_online FROM last_signed_in WHERE principal = ?").bind(this.principal).first<{ last_online: number | null }>()
            return json({ online: row?.last_online === null, last_online: row?.last_online ?? null })
        }
        return this.internal(action, data)
    }
    protected async internal(_action: string, _data: any): Promise<Response> { return new Response("Unknown action", { status: 404 }) }
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
    protected async command(ws: Socket, data: any, _attachment: Attachment): Promise<void> { ws.send(encode({ type: "ack", request_id: data.request_id, error: "Unknown command" })) }
    async webSocketClose(_ws: Socket): Promise<void> { await this.identity(); await this.sweep() }
    async webSocketError(ws: Socket): Promise<void> { ws.close(1011, "Connection error"); await this.identity(); await this.sweep() }
    async alarm(): Promise<void> { await this.identity(); await this.sweep() }
}
