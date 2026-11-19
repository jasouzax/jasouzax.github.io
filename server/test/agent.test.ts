import { test } from "node:test"
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Agent, video_backlog_bytes } from "../src/agent.ts"
import { Api_Registry } from "../src/api.ts"
import { Pty_Channel } from "../src/pty_channel.ts"
import { Script_Runner } from "../src/runner.ts"
import { Site_Registry } from "../src/sites.ts"
import { unpack_binary, to_base64 } from "../src/shared/codec.ts"
import type { Pty_Events } from "../src/pty.ts"

class Fake_Web extends EventEmitter {
    static keep_alive = false
    static async close_all(): Promise<number> { return 0 }
    constructor(public url = "about:blank") { super() }
    async close(): Promise<boolean> { this.emit("close"); return true }
}
class Fake_Windows extends EventEmitter {
    calls: unknown[][] = []
    infos: any[] = []
    owners = new Map<number, number>()
    list() { return this.infos }
    owner_of(id: number) { return this.owners.get(id) ?? id }
    async close(id: number) { this.calls.push(["close", id]) }
    async navigate(id: number, target: unknown) { this.calls.push(["navigate", id, target]) }
    async resize(id: number, size: unknown) { this.calls.push(["resize", id, size]) }
    async devtools(id: number, open: boolean) { this.calls.push(["devtools", id, open]) }
    async watch(id: number | null, width: number, audio?: boolean) { this.calls.push(["watch", id, width, audio]) }
    async input(id: number, input: unknown) { this.calls.push(["input", id, input]) }
    copy(id: number, cut?: boolean) { this.calls.push(["copy", id, cut]) }
    async paste(id: number, data: unknown) { this.calls.push(["paste", id, data]) }
    track() {}
}

function setup(options: { viewers?: boolean, buffered?: number, files?: Record<string, string> } = {}) {
    const root = mkdtempSync(join(tmpdir(), "agent-"))
    const sent: { message: any, to?: string }[] = []
    const hub: any[] = []
    const binary: Uint8Array[] = []
    const state = { viewers: options.viewers ?? true, buffered: options.buffered ?? 0 }
    const link = {
        get buffered() { return state.buffered },
        has_viewers: () => state.viewers,
        send: (message: any, to?: string) => { sent.push({ message, to }); return true },
        send_hub: (message: any) => { hub.push(message); return true },
        send_binary: (packet: Uint8Array) => { binary.push(packet); return true },
    }
    const windows = new Fake_Windows()
    const apis = new Api_Registry()
    const files = options.files ?? {}
    const runner = new Script_Runner({ read_source: async path => { if (!(path in files)) throw new Error("ENOENT"); return files[path] }, web_class: Fake_Web as any, apis, root: process.cwd(), catch_stray: false })
    const sites = new Site_Registry({ make_web: url => new Fake_Web(url) as any, windows: windows as any })
    const shells: { events: Pty_Events, written: Buffer[] }[] = []
    const pty = new Pty_Channel({ shim: "/x", send: (message, to) => link.send(message, to), buffered: () => 0, backend: "python", shell: "/bin/sh", home: "/tmp", open: (_options, events) => { const record = { events, written: [] as Buffer[] }; shells.push(record); return { write: data => record.written.push(data), resize() {}, pause() {}, resume() {}, close: () => events.on_exit(0) } } })
    const snapshot_calls: number[] = []
    const agent = new Agent({ link, runner, windows: windows as any, sites, apis, pty, fs_root: root, snapshot: async () => { snapshot_calls.push(1); return { text: "OS: test", taken_at: 5 } } })
    return { agent, sent, hub, binary, state, windows, runner, apis, sites, root, shells, snapshot_calls }
}
const settle = (ms = 20) => new Promise(resolve => setTimeout(resolve, ms))
async function wait_for(check: () => boolean): Promise<void> {
    const deadline = Date.now() + 5000
    while (!check()) {
        assert.ok(Date.now() < deadline, "Timed out waiting for the agent's filesystem reply")
        await settle(10)
    }
}

test("a page's fs request is answered to that page, with the errno code on failure", async () => {
    const { agent, sent, root } = setup()
    writeFileSync(join(root, "a.txt"), "hello")
    agent.handle({ t: "fs", id: 1, op: "read", path: join(root, "a.txt"), offset: 0, length: 100, peer: "p1" })
    agent.handle({ t: "fs", id: 2, op: "stat", path: join(root, "missing"), peer: "p1" })
    agent.handle({ t: "fs", id: 3, op: "explode" as any, path: root, peer: "p1" })
    await wait_for(() => sent.length === 3)
    // Answers may arrive in any order: they are matched by id
    const answer = (id: number) => sent.find(item => item.message.id === id)!.message
    assert.equal(sent.every(item => item.to === "p1"), true)
    assert.equal(answer(1).t, "fs_ok")
    assert.equal(Buffer.from(answer(1).result.data, "base64").toString(), "hello")
    assert.deepEqual([answer(2).t, answer(2).code], ["fs_err", "ENOENT"])
    assert.deepEqual([answer(3).t, answer(3).code], ["fs_err", "EINVAL"])
})

test("writes and paths outside the root are confined", async () => {
    const { agent, sent, root } = setup()
    agent.handle({ t: "fs", id: 1, op: "write", path: join(root, "out.txt"), offset: 0, data: to_base64(Buffer.from("x")), truncate: true, peer: "p" })
    agent.handle({ t: "fs", id: 2, op: "read", path: join(root, "../../../etc/passwd"), offset: 0, length: 10, peer: "p" })
    await wait_for(() => sent.length === 2)
    assert.equal(readFileSync(join(root, "out.txt"), "utf8"), "x")
    assert.deepEqual([sent.find(item => item.message.id === 2)!.message.code], ["EACCES"])
})

test("terminals are routed by page and end when the hub says the page is gone", () => {
    const { agent, shells, sent } = setup()
    agent.handle({ t: "pty_open", id: 1, cols: 80, rows: 24, peer: "p1" })
    agent.handle({ t: "pty_input", id: 1, data: to_base64(Buffer.from("ls\n")), peer: "p1" })
    assert.equal(shells[0].written[0].toString(), "ls\n")
    agent.handle({ t: "peer_gone", peer: "p1" })
    assert.deepEqual(sent.map(item => item.message.t), ["pty_exit"])
})

test("auto_state tells a connecting page about scripts and windows", async () => {
    const { agent, sent, windows } = setup({ files: { "/a.auto.js": "1" } })
    windows.infos = [{ id: 1, script: "site:x", title: "", url: "about:blank", icon: "", width: 800, height: 600, devtools: null }]
    await agent.handle({ t: "auto_start", path: "/a.auto.js", peer: "p1" })
    await settle()
    sent.length = 0
    agent.handle({ t: "auto_state", peer: "p2" })
    assert.deepEqual(sent.map(item => [item.message.t, item.to]), [["auto_state", "p2"], ["windows", "p2"]])
    assert.deepEqual(sent[0].message.scripts.map((script: any) => script.path), ["/a.auto.js"])
})

test("script logs and status are broadcast only while a page is connected, and replayed on request", async () => {
    const { agent, sent, state } = setup({ files: { "/a.auto.js": "console.log('hi')", "/b.auto.js": "console.log('later')" } })
    agent.handle({ t: "auto_start", path: "/a.auto.js", peer: "p" })
    await settle()
    const live = sent.filter(item => item.message.t === "auto_log").map(item => item.message.entry.text)
    assert.deepEqual(live, ["Started", "hi", "Ended"])
    assert.equal(sent.every(item => item.to === undefined), true)
    state.viewers = false
    sent.length = 0
    agent.handle({ t: "auto_start", path: "/b.auto.js", peer: "p" })
    await settle()
    assert.equal(sent.length, 0)
    state.viewers = true
    agent.handle({ t: "auto_logs", path: "/b.auto.js", peer: "p" })
    assert.deepEqual(sent[0].message.entries.map((entry: any) => entry.text), ["Started", "later", "Ended"])
    agent.handle({ t: "auto_clear_logs", path: "/b.auto.js", peer: "p" })
    assert.equal(sent.at(-1)!.message.t, "auto_logs_cleared")
})

test("a published API is announced to the hub and gateway calls are answered", async () => {
    const { agent, hub, apis } = setup()
    const api = apis.create({ script_id: "/s.auto.js", script_name: () => "x", run: task => task(), report() {}, closed() {} }, "sample", { public: true })
    api.get("hello", () => ({ hi: "there" }))
    assert.deepEqual(hub.at(-1), { t: "api_set", apis: [{ name: "sample", public: true }] })
    agent.handle({ t: "api_req", id: 9, name: "sample", method: "GET", path: "hello", query: {}, headers: {}, body: "", ip: "1.2.3.4" })
    await settle()
    const answer = hub.at(-1)
    assert.deepEqual([answer.t, answer.id, answer.status], ["api_res", 9, 200])
    assert.deepEqual(JSON.parse(Buffer.from(answer.body, "base64").toString()), { hi: "there" })
    agent.handle({ t: "api_req", id: 10, name: "nope", method: "GET", path: "", query: {}, headers: {}, body: "", ip: "" })
    await settle()
    assert.equal(hub.at(-1).status, 404)
})

test("the hub's snapshot request and a page's fastfetch both take a fresh snapshot", async () => {
    const { agent, hub, sent, snapshot_calls } = setup()
    agent.handle({ t: "fastfetch_req", id: 4 })
    agent.handle({ t: "fastfetch", peer: "p" })
    await settle()
    assert.deepEqual(hub.at(-1), { t: "fastfetch_res", id: 4, text: "OS: test", taken_at: 5 })
    assert.deepEqual([sent.at(-1)!.message.t, sent.at(-1)!.to], ["fastfetch", "p"])
    assert.equal(snapshot_calls.length, 2)
})

test("only the watched window is streamed, as sharp as the widest watcher, and nothing when the pages leave", async () => {
    const { agent, windows, binary } = setup()
    agent.handle({ t: "feed_watch", id: 1, max_width: 600, audio: false, peer: "a" })
    agent.handle({ t: "feed_watch", id: 1, max_width: 1000, audio: true, peer: "b" })
    await settle()
    assert.deepEqual(windows.calls.filter(call => call[0] === "watch").at(-1), ["watch", 1, 1000, true])
    windows.emit("frame", 1, Buffer.from([1, 2, 3]))
    windows.emit("frame", 2, Buffer.from([9]))
    windows.owners.set(77, 1)
    windows.emit("frame", 77, Buffer.from([7]))
    assert.deepEqual(binary.map(packet => { const frame = unpack_binary(packet)!; return [frame.kind, frame.id] }), [["video", 1], ["video", 77]])
    windows.emit("audio", 1, 12.5, Buffer.from([4]))
    windows.emit("audio", 2, 1, Buffer.from([4]))
    assert.equal(binary.length, 3)
    assert.deepEqual([unpack_binary(binary[2])!.kind, (unpack_binary(binary[2]) as any).timestamp], ["audio", 12.5])
    agent.handle({ t: "viewers", count: 0 })
    await settle()
    assert.deepEqual(windows.calls.filter(call => call[0] === "watch").at(-1), ["watch", null, 0, false])
})

test("a backed-up link drops pictures and sound instead of queueing them", () => {
    const { agent, windows, binary, state } = setup()
    agent.handle({ t: "feed_watch", id: 1, max_width: 800, audio: true, peer: "a" })
    state.buffered = video_backlog_bytes
    windows.emit("frame", 1, Buffer.from([1]))
    windows.emit("audio", 1, 1, Buffer.from([1]))
    assert.equal(binary.length, 0)
    state.buffered = 0
    state.viewers = false
    windows.emit("frame", 1, Buffer.from([1]))
    assert.equal(binary.length, 0)
})

test("window requests reach the registry with validated ids, and only watchers get hover and clipboard", async () => {
    const { agent, windows, sent } = setup()
    agent.handle({ t: "window_input", id: 3, input: { kind: "text", text: "x" }, peer: "a" })
    agent.handle({ t: "window_input", id: -1 as any, input: { kind: "text", text: "x" }, peer: "a" })
    agent.handle({ t: "window_navigate", id: 3, delta: 1, peer: "a" })
    agent.handle({ t: "window_navigate", id: 3, delta: 5 as any, url: "example.com", peer: "a" })
    agent.handle({ t: "window_devtools", id: 3, open: true, peer: "a" })
    agent.handle({ t: "window_resize", id: 3, size: null, peer: "a" })
    agent.handle({ t: "window_close", id: 3, peer: "a" })
    agent.handle({ t: "clipboard_copy", id: 3, cut: true, peer: "a" })
    agent.handle({ t: "clipboard_paste", id: 3, data: { text: "t" }, peer: "a" })
    await settle()
    assert.deepEqual(windows.calls.map(call => call[0]), ["input", "navigate", "navigate", "devtools", "resize", "close", "copy", "paste"])
    assert.deepEqual(windows.calls[2], ["navigate", 3, { url: "example.com", delta: undefined }])
    agent.handle({ t: "feed_watch", id: 3, max_width: 800, peer: "w" })
    sent.length = 0
    windows.emit("hover", 3, 1, [{ selector: "#a", confidence: 1, signals: [] }])
    windows.emit("clipboard", { text: "copied" })
    assert.deepEqual(sent.map(item => [item.message.t, item.to]), [["window_hover", "w"], ["clipboard", "w"]])
    windows.emit("removed", 3)
    sent.length = 0
    windows.emit("hover", 3, 2, [])
    assert.equal(sent.length, 0)
})

test("site windows open and close by key, and a dropped link clears watching and shells", async () => {
    const { agent, sites, windows, shells } = setup()
    agent.handle({ t: "site_open", key: "k", url: "https://example.com", peer: "a" })
    agent.handle({ t: "site_open", key: "k2", url: "file:///etc/passwd", peer: "a" })
    assert.equal(sites.count, 1)
    agent.handle({ t: "site_close", key: "k", peer: "a" })
    await settle()
    assert.equal(sites.count, 0)
    agent.handle({ t: "pty_open", id: 1, cols: 80, rows: 24, peer: "a" })
    agent.handle({ t: "feed_watch", id: 1, max_width: 800, peer: "a" })
    agent.on_link_closed()
    await settle()
    assert.equal(shells.length, 1)
    assert.deepEqual(windows.calls.filter(call => call[0] === "watch").at(-1), ["watch", null, 0, false])
})
