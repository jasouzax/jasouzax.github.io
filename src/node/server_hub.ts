/*
 * Server_Hub: the one Durable Object ("main") between the Pi agent and the owner's pages.
 *
 * Entities
 *   Server_Hub    hibernating WebSocket hub: relays pages <-> agent, keeps the endpoint map and the public snapshot, serves gateway calls
 *   Hub_Deps      the two platform calls tests replace (making a socket pair, answering 101)
 *
 * Responsibilities
 *   The Worker authenticated every request before it reached here and says who it is in `x-jazu-role` (agent | owner); nothing else can reach this object.
 *   Free-tier budget: heartbeats are auto-answered (the object never wakes for them); frames are relayed as received (no re-encoding) except that
 *   a page's text frame gets `peer` added; the endpoint map and snapshot are written only when they change.
 *   Pages learn nothing about endpoints: an unknown name and a private name asked by a stranger answer the same 404.
 * Limits
 *   One agent (a newer one replaces the older) and at most `max_owners` pages. Imports no `cloudflare:workers` code, so Node tests can load it.
 */
import { agent_direct_types, agent_message_types, api_body_limit, api_name_pattern, client_message_types, parse_message, reserved_api_names } from "../../server/src/shared/protocol.ts"
import type { Api_Answer, Api_Info, Public_Status } from "../../server/src/shared/protocol.ts"
import { api_error } from "./security.ts"
import { Rate_Limit } from "./server_limits.ts"

type Socket = WebSocket & { serializeAttachment(value: unknown): void, deserializeAttachment(): { peer: string, watching: boolean } | null }
type State = {
    acceptWebSocket(ws: WebSocket, tags?: string[]): void
    getWebSockets(tag?: string): Socket[]
    setWebSocketAutoResponse(value: unknown): void
    storage: { get<T>(key: string): Promise<T | undefined>, put(key: string, value: unknown): Promise<void>, delete(key: string): Promise<unknown> }
}
export type Hub_Deps = { make_pair?: () => [WebSocket, WebSocket], upgrade?: (client: WebSocket) => Response, now?: () => number }
type Snapshot = { text: string, taken_at: number }
type Waiting<Value> = { resolve: (value: Value) => void, timer: ReturnType<typeof setTimeout> }
export type Gateway_Call = { name: string, method: string, path: string, query: Record<string, string | string[]>, headers: Record<string, string>, body: string, ip: string, owner: boolean }

export const snapshot_max_age = 60_000
export const max_owners = 4
const call_timeout = 35_000
const snapshot_timeout = 10_000
const reserved = new Set<string>(reserved_api_names)

function send(ws: WebSocket, data: string | ArrayBuffer | Uint8Array): boolean {
    if (ws.readyState !== 1) return false
    try { ws.send(data as string); return true } catch { try { ws.close(1011, "Connection lost") } catch { /* already closed */ } return false }
}

export class Server_Hub {
    #apis: Api_Info[] | null = null
    #snapshot: Snapshot | null | undefined
    #refreshing: Promise<Snapshot | null> | null = null
    #next_id = 1
    readonly #calls = new Map<number, Waiting<Api_Answer | null>>()
    readonly #snapshots = new Map<number, Waiting<Snapshot | null>>()
    readonly #limit = new Rate_Limit({ per_key: 30, total: 300 })

    constructor(private ctx: State, _env: unknown, private deps: Hub_Deps = {}) {
        const Pair = (globalThis as { WebSocketRequestResponsePair?: new (request: string, response: string) => unknown }).WebSocketRequestResponsePair
        if (Pair) this.ctx.setWebSocketAutoResponse(new Pair("ping", "pong"))
    }

    // ---- entry ------------------------------------------------------------------------------------------------------------------------

    async fetch(request: Request): Promise<Response> {
        const path = new URL(request.url).pathname
        const role = request.headers.get("x-jazu-role")
        if (path === "/connect-agent" && role === "agent") return this.#connect_agent()
        if (path === "/connect-owner" && role === "owner") return this.#connect_owner()
        if (path === "/status" && request.method === "GET") return Response.json(await this.#status(), { headers: { "cache-control": "no-store" } })
        if (path === "/call" && request.method === "POST" && role === "gateway") return this.#gateway(await request.json() as Gateway_Call)
        return api_error("not_found", "Unknown route", 404)
    }

    #upgrade(): { client: WebSocket, server: WebSocket } {
        const [client, server] = this.deps.make_pair?.() ?? Object.values(new (globalThis as unknown as { WebSocketPair: new () => Record<string, WebSocket> }).WebSocketPair()) as [WebSocket, WebSocket]
        return { client, server }
    }

    #respond(client: WebSocket): Response {
        return this.deps.upgrade?.(client) ?? new Response(null, { status: 101, webSocket: client } as ResponseInit)
    }

    #agent(): Socket | undefined { return this.ctx.getWebSockets("agent").find(ws => ws.readyState === 1) }
    #owners(): Socket[] { return this.ctx.getWebSockets("owner").filter(ws => ws.readyState === 1) }
    #now(): number { return this.deps.now?.() ?? Date.now() }

    #connect_agent(): Response {
        for (const old of this.ctx.getWebSockets("agent")) try { old.close(4000, "Replaced by a newer agent") } catch { /* already closed */ }
        const { client, server } = this.#upgrade()
        this.ctx.acceptWebSocket(server, ["agent"])
        send(server, JSON.stringify({ t: "viewers", count: this.#owners().length }))
        this.#broadcast(JSON.stringify({ t: "status", online: true }))
        return this.#respond(client)
    }

    #connect_owner(): Response {
        if (this.#owners().length >= max_owners) return api_error("too_many", "Too many open pages", 429)
        const { client, server } = this.#upgrade()
        const peer = crypto.randomUUID().replaceAll("-", "").slice(0, 12)
        ;(server as Socket).serializeAttachment({ peer, watching: false })
        this.ctx.acceptWebSocket(server, ["owner"])
        send(server, JSON.stringify({ t: "welcome", peer, online: Boolean(this.#agent()) }))
        this.#viewers()
        return this.#respond(client)
    }

    #broadcast(frame: string | Uint8Array, only_watching = false): void {
        for (const ws of this.#owners()) if (!only_watching || ws.deserializeAttachment()?.watching) send(ws, frame)
    }

    #viewers(exclude?: WebSocket): void {
        const agent = this.#agent()
        if (agent) send(agent, JSON.stringify({ t: "viewers", count: this.#owners().filter(ws => ws !== exclude).length }))
    }

    // ---- sockets ----------------------------------------------------------------------------------------------------------------------

    async webSocketMessage(ws: Socket, message: string | ArrayBuffer): Promise<void> {
        const is_agent = this.ctx.getWebSockets("agent").includes(ws)
        if (typeof message !== "string") {
            // Only the agent sends pictures and sound, and only to the pages that watch a window
            if (is_agent) this.#broadcast(new Uint8Array(message), true)
            return
        }
        if (is_agent) await this.#from_agent(message)
        else this.#from_owner(ws, message)
    }

    async #from_agent(frame: string): Promise<void> {
        const message = parse_message(frame, new Set([...agent_message_types, ...agent_direct_types]))
        if (!message) return
        switch (message.t) {
            case "agent_hello": return
            case "api_set": return this.#set_apis(message.apis)
            case "api_res": return this.#settle(this.#calls, Number(message.id), message as unknown as Api_Answer)
            case "fastfetch_res": return this.#got_snapshot(Number(message.id), message)
        }
        const to = typeof message.to === "string" ? message.to : undefined
        if (to === undefined) return this.#broadcast(frame)
        const target = this.#owners().find(ws => ws.deserializeAttachment()?.peer === to)
        if (target) send(target, frame)
    }

    #from_owner(ws: Socket, frame: string): void {
        const attachment = ws.deserializeAttachment()
        const message = parse_message(frame, client_message_types)
        if (!attachment || !message) return
        if (message.t === "feed_watch") ws.serializeAttachment({ ...attachment, watching: message.id !== null })
        const agent = this.#agent()
        // `peer` comes last so a page cannot name another page
        if (agent) { send(agent, JSON.stringify({ ...message, peer: attachment.peer })); return }
        const id = Number(message.id)
        if (message.t === "fs") send(ws, JSON.stringify({ t: "fs_err", id, code: "EIO", message: "EIO: the server is offline" }))
        else if (message.t === "pty_open") send(ws, JSON.stringify({ t: "pty_err", id, message: "The server is offline" }))
    }

    async webSocketClose(ws: Socket): Promise<void> {
        const attachment = ws.deserializeAttachment()
        if (attachment) {
            const agent = this.#agent()
            if (agent) send(agent, JSON.stringify({ t: "peer_gone", peer: attachment.peer }))
            this.#viewers(ws)
            return
        }
        if (this.#agent()) return
        this.#broadcast(JSON.stringify({ t: "status", online: false }))
        for (const map of [this.#calls, this.#snapshots] as Map<number, Waiting<null>>[]) for (const id of [...map.keys()]) this.#settle(map, id, null)
        this.#apis = []
        await this.ctx.storage.delete("apis")
    }

    async webSocketError(ws: Socket): Promise<void> {
        try { ws.close(1011, "Error") } catch { /* already closed */ }
        await this.webSocketClose(ws)
    }

    #settle<Value>(map: Map<number, Waiting<Value | null>>, id: number, value: Value | null): void {
        const waiting = map.get(id)
        if (!waiting) return
        clearTimeout(waiting.timer)
        map.delete(id)
        waiting.resolve(value)
    }

    #wait<Value>(map: Map<number, Waiting<Value | null>>, id: number, ms: number): Promise<Value | null> {
        return new Promise(resolve => map.set(id, { resolve, timer: setTimeout(() => this.#settle(map, id, null), ms) }))
    }

    // ---- endpoint map -----------------------------------------------------------------------------------------------------------------

    async #load_apis(): Promise<Api_Info[]> {
        return this.#apis ??= await this.ctx.storage.get<Api_Info[]>("apis") ?? []
    }

    async #set_apis(value: unknown): Promise<void> {
        if (!Array.isArray(value) || value.length > 200) return
        const apis: Api_Info[] = []
        for (const item of value) {
            const name = (item as Api_Info)?.name
            if (typeof name !== "string" || !api_name_pattern.test(name) || reserved.has(name.toLowerCase()) || apis.some(known => known.name === name)) continue
            apis.push({ name, public: (item as Api_Info).public === true })
        }
        if (JSON.stringify(apis) === JSON.stringify(await this.#load_apis())) return
        this.#apis = apis
        await this.ctx.storage.put("apis", apis)
    }

    async #gateway(call: Gateway_Call): Promise<Response> {
        const known = (await this.#load_apis()).find(api => api.name === call.name)
        // Unknown and private-for-strangers are the same answer, so visitors cannot list the endpoints
        if (!known || (!known.public && !call.owner)) return api_error("not_found", "Not found", 404)
        const agent = this.#agent()
        if (!agent) return api_error("origin_offline", "The server is offline", 503)
        if (!call.owner) {
            const verdict = this.#limit.take(call.ip || "unknown", this.#now())
            if (!verdict.ok) return Response.json({ error: { code: "rate_limited", message: "Too many requests" } }, { status: 429, headers: { "retry-after": String(verdict.retry_after), "cache-control": "no-store" } })
        }
        if (typeof call.body !== "string" || call.body.length > api_body_limit * 4 / 3 + 4) return api_error("too_large", "The request body is too large", 413)
        const id = this.#next_id++
        const waiting = this.#wait(this.#calls, id, call_timeout)
        if (!send(agent, JSON.stringify({ t: "api_req", id, name: call.name, method: call.method, path: call.path, query: call.query, headers: call.headers, body: call.body, ip: call.ip }))) {
            this.#settle(this.#calls, id, null)
            return api_error("origin_offline", "The server is offline", 503)
        }
        const answer = await waiting
        if (!answer) return api_error(this.#agent() ? "gateway_timeout" : "origin_offline", this.#agent() ? "The API did not answer in time" : "The server is offline", this.#agent() ? 504 : 503)
        return Response.json({ status: answer.status, headers: answer.headers, body: answer.body }, { headers: { "cache-control": "no-store" } })
    }

    // ---- public snapshot --------------------------------------------------------------------------------------------------------------

    async #status(): Promise<Omit<Public_Status, "owner">> {
        const online = Boolean(this.#agent())
        this.#snapshot ??= await this.ctx.storage.get<Snapshot>("snapshot") ?? null
        let snapshot = this.#snapshot
        if (online && (!snapshot || this.#now() - snapshot.taken_at >= snapshot_max_age)) snapshot = await this.#refresh() ?? snapshot
        return { online, snapshot, stale: !online || !snapshot || this.#now() - snapshot.taken_at >= snapshot_max_age * 2 }
    }

    // One request to the Pi at a time, however many visitors ask
    #refresh(): Promise<Snapshot | null> {
        return this.#refreshing ??= (async () => {
            const agent = this.#agent()
            if (!agent) return null
            const id = this.#next_id++
            const waiting = this.#wait(this.#snapshots, id, snapshot_timeout)
            send(agent, JSON.stringify({ t: "fastfetch_req", id }))
            return waiting
        })().finally(() => { this.#refreshing = null })
    }

    async #got_snapshot(id: number, message: Record<string, unknown>): Promise<void> {
        if (typeof message.text !== "string" || message.text.length > 16_000) return this.#settle(this.#snapshots, id, null)
        const snapshot = { text: message.text, taken_at: this.#now() }
        this.#snapshot = snapshot
        await this.ctx.storage.put("snapshot", snapshot)
        this.#settle(this.#snapshots, id, snapshot)
    }
}
