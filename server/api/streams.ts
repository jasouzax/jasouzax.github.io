/* Transport-independent bounded channels. Capabilities, tickets and replay history live only in this release process. */
import { randomBytes } from "node:crypto"
import type { Api_Call, Api_Event, Api_Result } from "../../shared/api/types.ts"
import { Api_Error } from "./output.ts"

const message_limit = 16384, history_limit = 256 * 1024
const capability = () => randomBytes(32).toString("base64url")
export class Api_Channel {
    readonly epoch = randomBytes(12).toString("hex")
    readonly events: Api_Event[] = []
    private sequence = 0
    private bytes = 0
    private listeners = new Set<(data: unknown) => unknown>()
    readonly name: string
    constructor(name: string) { this.name = name }
    get cursor(): string { return `${this.epoch}:${this.sequence}` }
    emit(data: unknown, event = "message"): string {
        if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(event)) throw new Error("Invalid stream event name")
        const json = JSON.stringify(data)
        if (json === undefined || Buffer.byteLength(json) > message_limit) throw new Api_Error("message_too_large", "Stream messages must be JSON up to 16 KiB", 413)
        const value = JSON.parse(json), item = { id: `${this.epoch}:${++this.sequence}`, event, data: value }
        this.events.push(item); this.bytes += Buffer.byteLength(json)
        while (this.events.length > 256 || this.bytes > history_limit) this.bytes -= Buffer.byteLength(JSON.stringify(this.events.shift()!.data))
        for (const listener of this.listeners) { try { const result = listener(JSON.parse(json)); if (result && typeof (result as any).then === "function") void Promise.resolve(result).catch(() => {}) } catch { /* One consumer cannot prevent fanout. */ } }
        return item.id
    }
    read(cursor: string): Api_Event[] {
        const match = /^([a-f0-9]{24}):(\d{1,16})$/.exec(cursor)
        if (!match || match[1] !== this.epoch || !Number.isSafeInteger(Number(match[2])) || Number(match[2]) > this.sequence || Number(match[2]) < this.sequence - this.events.length) throw new Api_Error("resume_expired", "Stream history is unavailable; reconnect without a cursor", 409)
        return this.events.filter(item => Number(item.id.split(":")[1]) > Number(match[2])).slice(0, 16).map(item => structuredClone(item))
    }
    subscribe(listener: (data: unknown) => unknown): () => void {
        if (typeof listener !== "function" || this.listeners.size >= 64) throw new Error("Invalid subscriber or topic subscriber limit reached")
        this.listeners.add(listener); return () => this.listeners.delete(listener)
    }
}
export type Api_Socket = { readonly closed: boolean, send(data: unknown): string, onmessage: ((data: unknown) => unknown | Promise<unknown>) | null, onclose: (() => void) | null, close(): void }
export class Api_Stream_Output {
    readonly channel: Api_Channel
    readonly transport: "sse" | "websocket"
    readonly socket?: Api_Socket
    constructor(channel: Api_Channel, transport: "sse" | "websocket", socket?: Api_Socket) { this.channel = channel; this.transport = transport; this.socket = socket }
}
type Connection = { output: Api_Stream_Output, call: Api_Call, expires: number, idle: number, cursor: string }
export class Api_Streams {
    readonly channels = new Map<string, Api_Channel>()
    readonly connections = new Map<string, Connection>()
    readonly tickets = new Map<string, { call: Api_Call, expires: number }>()
    private timer: ReturnType<typeof setInterval>
    constructor() { this.timer = setInterval(() => this.sweep(), 10000); this.timer.unref() }
    channel(name: string): Api_Channel {
        if (typeof name !== "string" || !/^[a-zA-Z0-9_][a-zA-Z0-9_./-]{0,127}$/.test(name)) throw new Error("Invalid channel name")
        let channel = this.channels.get(name)
        if (!channel) { if (this.channels.size >= 128) throw new Error("API channel limit reached"); channel = new Api_Channel(name); this.channels.set(name, channel) }
        return channel
    }
    private sweep(): void {
        const now = Date.now()
        for (const [id, connection] of this.connections) if (connection.expires <= now || connection.idle <= now) this.drop(id)
        for (const [id, ticket] of this.tickets) if (ticket.expires <= now) this.tickets.delete(id)
    }
    ticket(call: Api_Call): { ticket: string, expires_at: number } {
        this.sweep()
        if (this.tickets.size >= 128) throw new Api_Error("busy", "Stream ticket limit reached", 503)
        const ticket = capability(), expires = Date.now() + 30000
        this.tickets.set(ticket, { call: structuredClone({ ...call, method: "GET", body: undefined }), expires })
        return { ticket, expires_at: expires }
    }
    private restore(original: Api_Call, incoming: Api_Call): Api_Call {
        if (incoming.path !== original.path || original.actor.owner && (!incoming.actor.owner || incoming.actor.subject !== original.actor.subject)) throw new Api_Error("not_found", "Stream unavailable", 404)
        return { ...original, actor: original.actor.owner ? incoming.actor : original.actor, ip: incoming.ip, request_id: incoming.request_id, stream: incoming.stream, headers: { ...original.headers, ...(incoming.headers["last-event-id"] ? { "last-event-id": incoming.headers["last-event-id"] } : {}) } }
    }
    prepare(call: Api_Call): Api_Call {
        if (call.stream) {
            const connection = this.connection(call.stream.id)
            return this.restore(connection.call, call)
        }
        if (call.query.ticket !== undefined) {
            if (call.method !== "GET" || typeof call.query.ticket !== "string") throw new Api_Error("invalid_ticket", "Invalid stream ticket", 403)
            const ticket = this.tickets.get(call.query.ticket); this.tickets.delete(call.query.ticket)
            if (!ticket || ticket.expires <= Date.now()) throw new Api_Error("invalid_ticket", "Stream ticket expired or used", 403)
            return this.restore(ticket.call, call)
        }
        return call
    }
    open(output: Api_Stream_Output, call: Api_Call): Api_Result["stream"] {
        this.sweep()
        if (this.connections.size >= 128) throw new Api_Error("busy", "Stream connection limit reached", 503)
        const cursor = call.headers["last-event-id"] ?? (output.socket ? `${output.channel.epoch}:0` : output.channel.cursor)
        output.channel.read(cursor)
        const id = capability()
        this.connections.set(id, { output, call: structuredClone(call), cursor, expires: Date.now() + 15 * 60000, idle: Date.now() + 60000 })
        return { id, cursor, transport: output.transport }
    }
    private connection(id: string): Connection {
        const connection = this.connections.get(id)
        if (!connection || connection.expires <= Date.now() || connection.idle <= Date.now()) { this.drop(id); throw new Api_Error("stream_expired", "Stream expired; reconnect", 410) }
        connection.idle = Date.now() + 60000
        return connection
    }
    async command(call: Api_Call): Promise<unknown> {
        const command = call.stream!, connection = this.connection(command.id)
        if (command.action === "close") { this.drop(command.id); return { closed: true } }
        if (command.action === "send") {
            if (!connection.output.socket || connection.output.socket.closed) throw new Api_Error("not_writable", "Stream is not writable", 405)
            const json = JSON.stringify(command.data)
            if (!json || Buffer.byteLength(json) > message_limit) throw new Api_Error("message_too_large", "Socket messages must be JSON up to 16 KiB", 413)
            await connection.output.socket.onmessage?.(JSON.parse(json))
            return { sent: true }
        }
        if (command.action !== "read") throw new Api_Error("invalid_request", "Unknown stream operation", 400)
        const events = connection.output.channel.read(command.cursor ?? connection.cursor)
        const cursor = events.at(-1)?.id ?? command.cursor ?? connection.cursor
        return { events, cursor, closed: !!connection.output.socket?.closed && cursor === connection.output.channel.cursor }
    }
    socket(): { output: Api_Stream_Output, socket: Api_Socket } {
        let closed = false
        const channel = new Api_Channel("socket"), socket: Api_Socket = { get closed() { return closed }, send: value => { if (closed) throw new Error("Socket closed"); return channel.emit(value) }, onmessage: null, onclose: null, close: () => { closed = true } }
        return { output: new Api_Stream_Output(channel, "websocket", socket), socket }
    }
    drop(id: string): void {
        const connection = this.connections.get(id); this.connections.delete(id)
        try { const result: unknown = connection?.output.socket?.onclose?.(); if (result && typeof (result as any).then === "function") void Promise.resolve(result).catch(() => {}) } catch { /* Cleanup must always release capabilities. */ }
    }
    close(): void { clearInterval(this.timer); for (const id of this.connections.keys()) this.drop(id); this.tickets.clear(); this.channels.clear() }
}
