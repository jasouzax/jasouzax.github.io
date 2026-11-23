/* Explicit, activation-gated MQTT 5 bridge. Broker ACLs and declared topic lists bound each owner/API namespace. */
import { connect, type MqttClient } from "mqtt"
import { randomBytes } from "node:crypto"
import { Api_Error } from "./output.ts"
export type Mqtt_Options = { url: string, prefix: string, topics: string[], publish?: string[], username_secret?: string, password_secret?: string }
export class Api_Mqtt {
    readonly ready: Promise<void>
    readonly options: Mqtt_Options
    private client: MqttClient | null = null
    private closed = false
    private pending = 0
    private resolve_ready!: () => void
    private reject_ready!: (error: Error) => void
    private credentials: { username?: string, password?: string }
    private receive: (topic: string, value: unknown) => void
    private log: (message: string) => void
    constructor(options: Mqtt_Options, secret: (name: string) => string, receive: (topic: string, value: unknown) => void, log: (message: string) => void) {
        const url = new URL(options.url)
        if (url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname) || url.protocol !== "mqtts:" && !(url.protocol === "mqtt:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) throw new Error("MQTT requires TLS, or loopback mqtt; credentials use declared secrets")
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_/-]{0,126}\/$/.test(options.prefix)) throw new Error("MQTT prefix must be an explicit namespace ending in /")
        const topics = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 64 && value.every(topic => typeof topic === "string" && /^[a-zA-Z0-9_][a-zA-Z0-9_./-]{0,127}$/.test(topic)) && new Set(value).size === value.length
        if (!topics(options.topics) || options.publish !== undefined && !topics(options.publish)) throw new Error("Declare up to 64 exact MQTT topics; wildcards are not accepted")
        this.options = structuredClone(options); this.receive = receive; this.log = log
        this.credentials = { ...(options.username_secret ? { username: secret(options.username_secret) } : {}), ...(options.password_secret ? { password: secret(options.password_secret) } : {}) }
        this.ready = new Promise((resolve, reject) => { this.resolve_ready = resolve; this.reject_ready = reject })
        void this.ready.catch(() => {})
    }
    activate(): void {
        if (this.client || this.closed) return
        const client = this.client = connect(this.options.url, { ...this.credentials, manualConnect: true, protocolVersion: 5, clientId: `jazu-${randomBytes(12).toString("hex")}`, clean: true, reconnectPeriod: 1000, connectTimeout: 5000, keepalive: 30, queueQoSZero: false, resubscribe: false, properties: { maximumPacketSize: 32768, receiveMaximum: 4 } })
        client.on("error", () => { if (!this.closed) this.log("MQTT broker connection failed") })
        client.on("connect", () => {
            void (async () => {
                try {
                    if (this.options.topics.length) {
                        const granted = await client.subscribeAsync(this.options.topics.map(topic => this.options.prefix + topic), { qos: 0 })
                        if (granted.some(grant => Number(grant.qos) !== 0)) throw new Error("MQTT subscription refused")
                    }
                    if (!this.closed) { this.resolve_ready(); this.log("MQTT bridge connected") }
                } catch { if (!this.closed) { this.log("MQTT subscription refused"); this.close() } }
            })()
        })
        client.on("message", (remote, payload) => {
            if (this.closed || !remote.startsWith(this.options.prefix) || payload.byteLength > 16384) return
            const topic = remote.slice(this.options.prefix.length)
            if (!this.options.topics.includes(topic)) return
            try { const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payload)); this.receive(topic, value) }
            catch { this.log("MQTT message rejected: expected bounded JSON") }
        })
        client.connect()
    }
    async publish(topic: string, data: unknown): Promise<void> {
        if (!(this.options.publish ?? this.options.topics).includes(topic)) throw new Api_Error("forbidden", "MQTT publication topic is not declared", 403)
        if (this.closed || !this.client?.connected) throw new Api_Error("mqtt_offline", "MQTT bridge is unavailable", 503)
        const json = JSON.stringify(data)
        if (json === undefined || Buffer.byteLength(json) > 16384) throw new Api_Error("message_too_large", "MQTT messages must be JSON up to 16 KiB", 413)
        if (this.pending >= 4) throw new Api_Error("busy", "MQTT bridge has too many pending publications", 503)
        this.pending++
        try { await this.client.publishAsync(this.options.prefix + topic, json, { qos: 0, retain: false }) }
        finally { this.pending-- }
    }
    close(): void { if (this.closed) return; this.closed = true; this.reject_ready(new Error("MQTT bridge closed")); this.client?.end(true); this.credentials = {} }
}
