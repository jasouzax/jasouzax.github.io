import { test } from "node:test"
import assert from "node:assert/strict"
import { createServer, type Socket } from "node:net"
import { once } from "node:events"
import { Api_Mqtt } from "../../../server/api/mqtt.ts"

// A real TCP MQTT 5 peer drives CONNECT/SUBSCRIBE/PUBLISH/PING, including fragmented packets.
async function broker() {
    const sockets = new Set<Socket>(), publications: { topic: string, data: string }[] = []
    let subscription = ""
    const server = createServer(socket => {
        sockets.add(socket); socket.on("close", () => sockets.delete(socket))
        let input = Buffer.alloc(0)
        socket.on("data", chunk => {
            input = Buffer.concat([input, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)])
            while (input.length >= 2) {
                let remaining = 0, multiplier = 1, offset = 1, byte: number
                do { if (offset >= input.length) return; byte = input[offset++]; remaining += (byte & 127) * multiplier; multiplier *= 128 } while (byte & 128)
                if (input.length < offset + remaining) return
                const kind = input[0] >> 4, payload = input.subarray(offset, offset + remaining)
                input = input.subarray(offset + remaining)
                if (kind === 1) socket.write(Buffer.from([0x20, 3, 0, 0, 0])) // MQTT 5 CONNACK.
                if (kind === 8) {
                    const length = payload.readUInt16BE(3)
                    subscription = payload.subarray(5, 5 + length).toString()
                    socket.write(Buffer.from([0x90, 4, payload[0], payload[1], 0, 0]))
                }
                if (kind === 3) {
                    const length = payload.readUInt16BE(0)
                    publications.push({ topic: payload.subarray(2, 2 + length).toString(), data: payload.subarray(3 + length).toString() })
                }
                if (kind === 12) socket.write(Buffer.from([0xd0, 0]))
            }
        })
    }).listen(0, "127.0.0.1")
    await once(server, "listening")
    return {
        url: `mqtt://127.0.0.1:${(server.address() as any).port}`, publications, get subscription() { return subscription },
        send(topic: string, data: string) {
            const name = Buffer.from(topic), bytes = Buffer.from(data), size = name.length + bytes.length + 3, length: number[] = []
            let remaining = size
            do { let value = remaining % 128; remaining = Math.floor(remaining / 128); if (remaining) value |= 128; length.push(value) } while (remaining)
            const packet = Buffer.concat([Buffer.from([0x30, ...length, name.length >> 8, name.length & 255]), name, Buffer.from([0]), bytes])
            for (const socket of sockets) { socket.write(packet.subarray(0, 2)); socket.write(packet.subarray(2)) }
        },
        async close() { for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())) }
    }
}
test("MQTT bridge waits for activation, isolates topics, forwards bounded JSON and never queues offline writes", { timeout: 10000 }, async () => {
    const peer = await broker(), values: [string, unknown][] = [], logs: string[] = []
    const bridge = new Api_Mqtt({ url: peer.url, prefix: "owner/api/", topics: ["temperature"], publish: ["commands"] }, () => { throw new Error("unexpected secret") }, (topic, value) => values.push([topic, value]), message => logs.push(message))
    try {
        await assert.rejects(bridge.publish("commands", {}), /unavailable/)
        assert.equal(peer.subscription, "")
        bridge.activate(); await bridge.ready
        assert.equal(peer.subscription, "owner/api/temperature")
        peer.send("owner/api/temperature", '{"c":30}'); peer.send("other/api/temperature", '{"c":999}'); peer.send("owner/api/temperature", "invalid JSON")
        for (let attempt = 0; attempt < 100 && (!values.length || !logs.some(value => value.includes("rejected"))); attempt++) await new Promise(resolve => setTimeout(resolve, 10))
        assert.deepEqual(values, [["temperature", { c: 30 }]])
        assert(logs.some(value => value.includes("rejected")))
        await bridge.publish("commands", { run: true })
        for (let attempt = 0; attempt < 100 && !peer.publications.length; attempt++) await new Promise(resolve => setTimeout(resolve, 10))
        assert.deepEqual(peer.publications, [{ topic: "owner/api/commands", data: '{"run":true}' }])
        await assert.rejects(bridge.publish("temperature", 1), /not declared/)
        await assert.rejects(bridge.publish("commands", "x".repeat(16385)), /16 KiB/)
        bridge.close(); await assert.rejects(bridge.publish("commands", {}), /unavailable/)
    } finally { bridge.close(); await peer.close() }
})
test("MQTT configuration refuses remote plaintext, wildcard topics and undeclared credentials", () => {
    const base = { url: "mqtts://broker.example.com", prefix: "owner/api/", topics: ["temperature"] }
    const make = (options: any) => new Api_Mqtt(options, () => { throw new Error("Undeclared secret") }, () => {}, () => {})
    assert.throws(() => make({ ...base, url: "mqtt://broker.example.com" }), /TLS/)
    assert.throws(() => make({ ...base, url: "mqtts://user:password@broker.example.com" }), /credentials/)
    assert.throws(() => make({ ...base, topics: ["#"] }), /wildcards/)
    assert.throws(() => make({ ...base, username_secret: "UNDECLARED" }), /Undeclared/)
    assert.throws(() => make({ ...base, prefix: "" }), /namespace/)
})
