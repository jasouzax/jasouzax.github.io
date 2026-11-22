import test from "node:test"
import assert from "node:assert/strict"
import { Server_Link, Fs_Error, fetch_public_status, default_socket_url, type Socket_Like, type Timer_Api } from "../src/web/client/server_link.ts"
import { pack_video } from "../shared/protocol/codec.ts"

class Fake implements Socket_Like {
    readyState = 0; binaryType = ""; sent: string[] = []
    onopen: (() => void) | null = null; onclose: (() => void) | null = null; onerror: (() => void) | null = null; onmessage: ((event: { data: unknown }) => void) | null = null
    send(data: string): void { this.sent.push(data) }
    close(): void { this.readyState = 3; this.onclose?.() }
    open(): void { this.readyState = 1; this.onopen?.() }
    say(message: unknown): void { this.onmessage?.({ data: typeof message === "string" ? message : JSON.stringify(message) }) }
}

function harness() {
    const sockets: Fake[] = []
    const timers: { id: number, fn: () => void, ms: number, repeat: boolean, live: boolean }[] = []
    const api: Timer_Api = {
        set: (fn, ms) => { const t = { id: timers.length, fn, ms, repeat: false, live: true }; timers.push(t); return t.id },
        set_interval: (fn, ms) => { const t = { id: timers.length, fn, ms, repeat: true, live: true }; timers.push(t); return t.id },
        clear: id => { const t = timers[id as number]; if (t) t.live = false },
    }
    const link = new Server_Link({ url: "wss://x/api/server/ws", make_socket: () => { const s = new Fake(); sockets.push(s); return s }, timers: api })
    return { link, sockets, timers }
}

test("welcome makes the link connected and online, status follows the agent", () => {
    const { link, sockets } = harness()
    const seen: string[] = []
    link.on_state(() => seen.push(`${link.connected}/${link.online}`))
    link.open(); sockets[0].open(); sockets[0].say({ t: "welcome", peer: "p1", online: false })
    assert.equal(link.peer, "p1"); assert.equal(link.connected, true); assert.equal(link.online, false)
    sockets[0].say({ t: "status", online: true })
    assert.deepEqual(seen, ["true/false", "true/true"])
})

test("fs requests are numbered, answered by id and rejected with the Pi's code", async () => {
    const { link, sockets } = harness()
    link.open(); sockets[0].open(); sockets[0].say({ t: "welcome", peer: "p", online: true })
    const ok = link.fs({ op: "stat", path: "/etc" })
    const bad = link.fs({ op: "stat", path: "/nope" })
    const [first, second] = sockets[0].sent.map(text => JSON.parse(text))
    assert.equal(first.t, "fs"); assert.equal(first.op, "stat"); assert.notEqual(first.id, second.id)
    sockets[0].say({ t: "fs_err", id: second.id, code: "ENOENT", message: "no such file" })
    sockets[0].say({ t: "fs_ok", id: first.id, result: { op: "stat", stat: { kind: "dir", size: 0, mtime: 1, mode: 0o755, writable: true } } })
    assert.equal(((await ok) as { stat: { kind: string } }).stat.kind, "dir")
    await assert.rejects(bad, (error: Fs_Error) => error.code === "ENOENT")
})

test("offline requests fail at once; a lost socket fails pending ones and reconnects with backoff", async () => {
    const { link, sockets, timers } = harness()
    await assert.rejects(link.fs({ op: "list", path: "/" }), (error: Fs_Error) => error.code === "OFFLINE")
    link.open(); sockets[0].open(); sockets[0].say({ t: "welcome", peer: "p", online: true })
    const pending = link.fs({ op: "list", path: "/" })
    sockets[0].readyState = 3; sockets[0].onclose?.()
    await assert.rejects(pending, (error: Fs_Error) => error.code === "OFFLINE")
    assert.equal(link.connected, false)
    const retry = timers.filter(t => !t.repeat && t.live).at(-1)!
    assert.equal(retry.ms, 1000)
    retry.fn()
    assert.equal(sockets.length, 2)
    sockets[1].readyState = 3; sockets[1].onclose?.()
    assert.equal(timers.filter(t => !t.repeat && t.live).at(-1)!.ms, 2000)
})

test("close() stops reconnecting; the heartbeat is the bare ping text; garbage is ignored", () => {
    const { link, sockets, timers } = harness()
    link.open(); sockets[0].open()
    const beat = timers.find(t => t.repeat)!
    beat.fn()
    assert.deepEqual(sockets[0].sent, ["ping"])
    sockets[0].say("pong"); sockets[0].say("not json"); sockets[0].say({ t: "evil" })
    link.close()
    assert.equal(sockets.length, 1)
    assert.equal(timers.filter(t => !t.repeat && t.live).length, 0)
    assert.equal(beat.live, false)
})

test("subscriptions get their message types, binary frames are unpacked", () => {
    const { link, sockets } = harness()
    const logs: unknown[] = []; const frames: unknown[] = []
    link.on("auto_log", message => logs.push(message.entry))
    link.on_binary(frame => frames.push(frame))
    link.open(); sockets[0].open()
    sockets[0].say({ t: "auto_log", path: "/a.auto.js", entry: { id: 1, time: 2, level: "log", text: "hi" } })
    const packet = pack_video(7, new Uint8Array([1, 2, 3]))
    sockets[0].onmessage?.({ data: packet.buffer.slice(packet.byteOffset, packet.byteOffset + packet.byteLength) })
    assert.equal(logs.length, 1)
    assert.deepEqual(frames, [{ kind: "video", id: 7, payload: new Uint8Array([1, 2, 3]) }])
})

test("send is refused while the socket is not open; the socket url follows the page's scheme", () => {
    const { link } = harness()
    assert.equal(link.send({ t: "auto_state" }), false)
    assert.equal(default_socket_url({ protocol: "https:", host: "jasouza.com" }), "wss://jasouza.com/api/server/ws")
    assert.equal(default_socket_url({ protocol: "http:", host: "127.0.0.1:8787" }), "ws://127.0.0.1:8787/api/server/ws")
})

test("fetch_public_status normalises the answer and rejects an error status", async () => {
    const good = await fetch_public_status((async () => Response.json({ online: true, owner: false, snapshot: { text: "x", taken_at: 5 } })) as typeof fetch)
    assert.deepEqual(good, { online: true, owner: false, snapshot: { text: "x", taken_at: 5 }, stale: false })
    await assert.rejects(fetch_public_status((async () => new Response("no", { status: 503 })) as typeof fetch))
})
