/* Server_Hub with fake sockets: relaying and peer injection, endpoint privacy, gateway answers/timeouts/limits, one-minute snapshot, picture routing. */
import { test, mock } from "node:test"
import assert from "node:assert/strict"
import { Server_Hub, snapshot_max_age } from "../src/node/server_hub.ts"

class Fake {
    readyState = 1
    sent: (string | Uint8Array)[] = []
    attachment: unknown = null
    closed: number | null = null
    send(data: string | Uint8Array) { this.sent.push(data) }
    close(code?: number) { this.readyState = 3; this.closed = code ?? 1000 }
    serializeAttachment(value: unknown) { this.attachment = value }
    deserializeAttachment() { return this.attachment as any }
    json(): any[] { return this.sent.filter(item => typeof item === "string").map(item => JSON.parse(item as string)) }
}
function setup() {
    const tags = new Map<Fake, string[]>()
    const store = new Map<string, unknown>()
    const pairs: Fake[] = []
    let clock = 1_000_000
    const ctx = {
        acceptWebSocket: (ws: any, list?: string[]) => { tags.set(ws, list ?? []) },
        getWebSockets: (tag?: string) => [...tags].filter(([, list]) => !tag || list.includes(tag)).map(([ws]) => ws) as any[],
        setWebSocketAutoResponse() {},
        storage: { get: async (key: string) => store.get(key) as any, put: async (key: string, value: unknown) => { store.set(key, value) }, delete: async (key: string) => store.delete(key) },
    }
    const hub = new Server_Hub(ctx as any, {}, { make_pair: () => { const server = new Fake(); pairs.push(server); return [new Fake() as any, server as any] }, upgrade: () => new Response(null, { status: 200 }), now: () => clock })
    const connect = async (role: "agent" | "owner") => {
        const response = await hub.fetch(new Request(`https://hub.internal/connect-${role}`, { headers: { "x-jazu-role": role } }))
        return { response, socket: pairs.at(-1)! }
    }
    return { hub, connect, store, tags, advance: (ms: number) => { clock += ms } }
}
const flush = async () => { for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve)) }
const call = (overrides: object = {}) => ({ name: "sample", method: "GET", path: "x", query: {}, headers: {}, body: "", ip: "1.1.1.1", owner: false, ...overrides })
async function answered(hub: Server_Hub, agent: { socket: Fake }, pending: Promise<Response>, status = 200): Promise<Response> {
    await flush()
    const request = agent.socket.json().findLast((item: any) => item.t === "api_req")
    await hub.webSocketMessage(agent.socket as any, JSON.stringify({ t: "api_res", id: request.id, status, headers: {}, body: "" }))
    return pending
}
const gateway = (hub: Server_Hub, body: object) => hub.fetch(new Request("https://hub.internal/call", { method: "POST", headers: { "x-jazu-role": "gateway" }, body: JSON.stringify(body) }))

test("only the Worker's role headers open a connection, and a page cannot reach the gateway", async () => {
    const { hub } = setup()
    assert.equal((await hub.fetch(new Request("https://hub.internal/connect-agent"))).status, 404)
    assert.equal((await hub.fetch(new Request("https://hub.internal/connect-owner", { headers: { "x-jazu-role": "agent" } }))).status, 404)
    assert.equal((await hub.fetch(new Request("https://hub.internal/call", { method: "POST", body: "{}" }))).status, 404)
})

test("pages and agent: welcome, viewer counts, peer injection that cannot be spoofed, targeted and broadcast answers", async () => {
    const { hub, connect } = setup()
    const owner = await connect("owner")
    assert.deepEqual(owner.socket.json()[0].online, false)
    const agent = await connect("agent")
    assert.deepEqual(agent.socket.json()[0], { t: "viewers", count: 1 })
    assert.deepEqual(owner.socket.json().at(-1), { t: "status", online: true })
    const second = await connect("owner")
    assert.deepEqual(agent.socket.json().at(-1), { t: "viewers", count: 2 })
    const peer = owner.socket.json()[0].peer, other = second.socket.json()[0].peer
    await hub.webSocketMessage(owner.socket as any, JSON.stringify({ t: "fs", id: 3, op: "stat", path: "/", peer: "forged" }))
    assert.deepEqual(agent.socket.json().at(-1), { t: "fs", id: 3, op: "stat", path: "/", peer })
    await hub.webSocketMessage(owner.socket as any, JSON.stringify({ t: "api_set", apis: [] }))
    await hub.webSocketMessage(owner.socket as any, "not json")
    assert.equal(agent.socket.json().length, 3, "viewers x2 and the fs request only")
    await hub.webSocketMessage(agent.socket as any, JSON.stringify({ t: "fs_ok", id: 3, result: { op: "mkdir" }, to: other }))
    assert.equal(second.socket.json().at(-1).t, "fs_ok")
    assert.notEqual(owner.socket.json().at(-1).t, "fs_ok")
    await hub.webSocketMessage(agent.socket as any, JSON.stringify({ t: "auto_status", path: "/a.auto.js", running: true }))
    assert.equal(owner.socket.json().at(-1).t, "auto_status")
    assert.equal(second.socket.json().at(-1).t, "auto_status")
    await hub.webSocketClose(second.socket as any)
    assert.deepEqual(agent.socket.json().slice(-2), [{ t: "peer_gone", peer: other }, { t: "viewers", count: 1 }])
})

test("offline: requests that wait for an answer get an error at once, others are dropped; at most four pages", async () => {
    const { hub, connect } = setup()
    const owner = await connect("owner")
    await hub.webSocketMessage(owner.socket as any, JSON.stringify({ t: "fs", id: 9, op: "stat", path: "/" }))
    await hub.webSocketMessage(owner.socket as any, JSON.stringify({ t: "pty_open", id: 2, cols: 80, rows: 24 }))
    const replies = owner.socket.json().slice(1)
    assert.equal(replies[0].t, "fs_err"); assert.equal(replies[0].id, 9)
    assert.equal(replies[1].t, "pty_err")
    for (let i = 0; i < 3; i++) await connect("owner")
    assert.equal((await connect("owner")).response.status, 429)
})

test("pictures go only to pages that watch a window", async () => {
    const { hub, connect } = setup()
    const watching = await connect("owner"), idle = await connect("owner"), agent = await connect("agent")
    await hub.webSocketMessage(watching.socket as any, JSON.stringify({ t: "feed_watch", id: 4, max_width: 800 }))
    await hub.webSocketMessage(agent.socket as any, Uint8Array.of(1, 0, 0, 0, 4, 7).buffer)
    await hub.webSocketMessage(watching.socket as any, Uint8Array.of(1, 0, 0, 0, 4, 7).buffer)
    assert.equal(watching.socket.sent.filter(item => typeof item !== "string").length, 1)
    assert.equal(idle.socket.sent.filter(item => typeof item !== "string").length, 0)
    await hub.webSocketMessage(watching.socket as any, JSON.stringify({ t: "feed_watch", id: null, max_width: 800 }))
    await hub.webSocketMessage(agent.socket as any, Uint8Array.of(1, 0, 0, 0, 4, 8).buffer)
    assert.equal(watching.socket.sent.filter(item => typeof item !== "string").length, 1)
})

test("gateway: unknown and private-for-strangers look identical; public and owner calls reach the agent and come back", async () => {
    const { hub, connect } = setup()
    const agent = await connect("agent")
    await hub.webSocketMessage(agent.socket as any, JSON.stringify({ t: "api_set", apis: [{ name: "open", public: true }, { name: "secret", public: false }, { name: "v1", public: true }, { name: "bad name", public: true }] }))
    const missing = await gateway(hub, call({ name: "nothing" })), hidden = await gateway(hub, call({ name: "secret" }))
    assert.equal(missing.status, 404); assert.equal(hidden.status, 404)
    assert.deepEqual(await missing.json(), await hidden.json())
    assert.equal((await gateway(hub, call({ name: "v1" }))).status, 404)
    for (const [name, owner] of [["open", false], ["secret", true]] as const) {
        const pending = gateway(hub, call({ name, owner, path: "a/b", query: { q: "1" } }))
        await flush()
        const request = agent.socket.json().findLast((item: any) => item.t === "api_req")
        assert.equal(request.name, name); assert.equal(request.path, "a/b")
        await hub.webSocketMessage(agent.socket as any, JSON.stringify({ t: "api_res", id: request.id, status: 201, headers: { "content-type": "text/plain" }, body: "aGk=" }))
        assert.deepEqual(await (await pending).json(), { status: 201, headers: { "content-type": "text/plain" }, body: "aGk=" })
    }
})

test("gateway: 503 offline, 504 on silence, 429 for a noisy stranger but never for the owner, apis forgotten when the agent leaves", async () => {
    mock.timers.enable({ apis: ["setTimeout"] })
    try {
        const { hub, connect, store } = setup()
        const agent = await connect("agent")
        await hub.webSocketMessage(agent.socket as any, JSON.stringify({ t: "api_set", apis: [{ name: "open", public: true }] }))
        const silent = gateway(hub, call({ owner: true, name: "open" }))
        await flush()
        mock.timers.tick(36_000)
        assert.equal((await silent).status, 504)
        for (let i = 0; i < 30; i++) {
            const pending = gateway(hub, call({ name: "open", ip: "9.9.9.9" }))
            await flush()
            const request = agent.socket.json().findLast((item: any) => item.t === "api_req")
            await hub.webSocketMessage(agent.socket as any, JSON.stringify({ t: "api_res", id: request.id, status: 200, headers: {}, body: "" }))
            await pending
        }
        const limited = await gateway(hub, call({ name: "open", ip: "9.9.9.9" }))
        assert.equal(limited.status, 429); assert.ok(limited.headers.get("retry-after"))
        const owner_call = await answered(hub, agent, gateway(hub, call({ name: "open", ip: "9.9.9.9", owner: true })), 202)
        assert.equal((await owner_call.json()).status, 202, "the owner is not rate limited")
        agent.socket.close()
        await hub.webSocketClose(agent.socket as any)
        assert.equal((await gateway(hub, call({ name: "open", owner: true }))).status, 404)
        assert.equal(store.has("apis"), false)
    } finally { mock.timers.reset() }
})

test("snapshot: fetched once per minute for any number of visitors, kept for the offline page", async () => {
    const { hub, connect, advance } = setup()
    const status = () => hub.fetch(new Request("https://hub.internal/status")).then(response => response.json()) as Promise<any>
    assert.deepEqual(await status(), { online: false, snapshot: null, stale: true })
    const agent = await connect("agent")
    const first = Promise.all([status(), status(), status()])
    await flush()
    const requests = agent.socket.json().filter((item: any) => item.t === "fastfetch_req")
    assert.equal(requests.length, 1, "single flight")
    await hub.webSocketMessage(agent.socket as any, JSON.stringify({ t: "fastfetch_res", id: requests[0].id, text: "OS: Pi", taken_at: 1 }))
    for (const result of await first) assert.deepEqual([result.online, result.snapshot.text, result.stale], [true, "OS: Pi", false])
    await status()
    assert.equal(agent.socket.json().filter((item: any) => item.t === "fastfetch_req").length, 1, "cached")
    advance(snapshot_max_age + 1)
    const again = status()
    await flush()
    assert.equal(agent.socket.json().filter((item: any) => item.t === "fastfetch_req").length, 2)
    await hub.webSocketMessage(agent.socket as any, JSON.stringify({ t: "fastfetch_res", id: 2, text: "OS: Pi 2", taken_at: 1 }))
    assert.equal((await again).snapshot.text, "OS: Pi 2")
    agent.socket.close(); await hub.webSocketClose(agent.socket as any)
    advance(10 * snapshot_max_age)
    const offline = await status()
    assert.deepEqual([offline.online, offline.snapshot.text, offline.stale], [false, "OS: Pi 2", true])
})
