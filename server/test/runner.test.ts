import { test } from "node:test"
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { Script_Runner, max_logs_per_script } from "../browser/runner.ts"
import { Api_Registry } from "../api/prototype.ts"

class Fake_Web extends EventEmitter {
    static keep_alive = false
    static opened: Fake_Web[] = []
    static get pages(): Fake_Web[] { return Fake_Web.opened }
    static async close_all(): Promise<number> { return 0 }
    url: string
    closed = false
    constructor(url = "about:blank") { super(); this.url = url; Fake_Web.opened.push(this) }
    async close(): Promise<boolean> { this.closed = true; this.emit("close"); return true }
}

function setup(files: Record<string, string>) {
    Fake_Web.opened = []
    const apis = new Api_Registry()
    const runner = new Script_Runner({ read_source: async file => { if (!(file in files)) throw new Error("ENOENT"); return files[file] }, web_class: Fake_Web as any, apis, root: process.cwd(), catch_stray: false })
    const events: [string, ...unknown[]][] = []
    for (const name of ["status", "logs_cleared"]) runner.on(name, (...args) => events.push([name, ...args]))
    return { runner, apis, events }
}
const settle = (ms = 20) => new Promise(resolve => setTimeout(resolve, ms))
const texts = (runner: Script_Runner, file: string) => runner.logs(file).map(entry => `${entry.level}:${entry.text}`)

test("a script that finishes logs Started, its output and Ended", async () => {
    const { runner, events } = setup({ "/a.auto.js": "console.log('hi', 1); console.warn('careful')" })
    await runner.start("/a.auto.js")
    await settle()
    assert.deepEqual(texts(runner, "/a.auto.js"), ["system:Started", "log:hi 1", "warn:careful", "system:Ended"])
    assert.equal(runner.is_running("/a.auto.js"), false)
    assert.deepEqual(events.filter(event => event[0] === "status").map(event => event[2]), [true, false])
})

test("only .auto.js files run and an unreadable file is a log line", async () => {
    const { runner } = setup({ "/a.js": "1" })
    await runner.start("/a.js")
    assert.deepEqual(runner.list(), [])
    await runner.start("/missing.auto.js")
    assert.match(runner.logs("/missing.auto.js")[0].text, /Cannot read/)
    assert.equal(runner.is_running("/missing.auto.js"), false)
})

test("a thrown error and a syntax error are logged without the wrapper", async () => {
    const { runner } = setup({ "/t.auto.js": "throw new Error('nope')", "/s.auto.js": "let = = 1" })
    await runner.start("/t.auto.js")
    await runner.start("/s.auto.js")
    await settle()
    assert.match(texts(runner, "/t.auto.js")[1], /^error:Error: nope/)
    assert.match(texts(runner, "/s.auto.js")[1], /^error:SyntaxError/)
    assert.equal(runner.is_running("/t.auto.js"), false)
})

test("a timer makes the script a service until it is stopped; stop wakes sleepers and closes windows", async () => {
    const { runner } = setup({ "/svc.auto.js": "const web = new Web('https://x.test'); setInterval(() => console.log('tick'), 5); await sleep(100000)" })
    await runner.start("/svc.auto.js")
    await settle(40)
    assert.equal(runner.is_running("/svc.auto.js"), true)
    assert.deepEqual(runner.list(), [{ path: "/svc.auto.js", running: true, windows: 1 }])
    assert.ok(texts(runner, "/svc.auto.js").includes("log:tick"))
    await runner.stop("/svc.auto.js")
    assert.equal(runner.is_running("/svc.auto.js"), false)
    assert.equal(Fake_Web.opened[0].closed, true)
    const count = runner.logs("/svc.auto.js").length
    await settle(30)
    assert.equal(runner.logs("/svc.auto.js").length, count)
    assert.equal(texts(runner, "/svc.auto.js").at(-1), "system:Ended")
})

test("an API keeps the script running and disappears when it stops", async () => {
    const { runner, apis } = setup({ "/api.auto.js": "new API('hello').get('', () => ({ ok: true }))" })
    await runner.start("/api.auto.js")
    await settle()
    assert.equal(runner.is_running("/api.auto.js"), true)
    assert.deepEqual(apis.list(), [{ name: "hello", public: false }])
    await runner.stop("/api.auto.js")
    assert.deepEqual(apis.list(), [])
})

test("a second start while running does nothing; a restart after stop begins a new run", async () => {
    const { runner } = setup({ "/r.auto.js": "setTimeout(() => {}, 100000)" })
    await runner.start("/r.auto.js")
    await runner.start("/r.auto.js")
    assert.equal(runner.logs("/r.auto.js").filter(entry => entry.text === "Started").length, 1)
    await runner.stop("/r.auto.js")
    await runner.start("/r.auto.js")
    assert.equal(runner.is_running("/r.auto.js"), true)
    await runner.stop_all()
    assert.equal(runner.is_running("/r.auto.js"), false)
})

test("logs are capped, clearable, and open_window adds a blank window without running anything", async () => {
    const { runner, events } = setup({ "/l.auto.js": `for (let i = 0; i < ${max_logs_per_script + 50}; i++) console.log(i)` })
    await runner.start("/l.auto.js")
    await settle(50)
    assert.equal(runner.logs("/l.auto.js").length, max_logs_per_script)
    runner.clear_logs("/l.auto.js")
    assert.equal(runner.logs("/l.auto.js").length, 0)
    assert.ok(events.some(event => event[0] === "logs_cleared"))
    assert.equal(runner.open_window("/w.auto.js"), true)
    assert.equal(runner.open_window("/w.txt"), false)
    assert.deepEqual(runner.list().find(item => item.path === "/w.auto.js"), { path: "/w.auto.js", running: false, windows: 1 })
})

test("deleting a session stops its APIs and windows and forgets logs without deleting source", async () => {
    const { runner, apis } = setup({ "/delete.auto.js": "new Web('https://example.com'); new API('session').get('', () => 'ok')" })
    const deleted: string[] = []
    runner.on("deleted", path => deleted.push(path))
    await runner.start("/delete.auto.js")
    await settle()
    assert.equal(runner.is_running("/delete.auto.js"), true)
    await runner.remove("/delete.auto.js")
    assert.deepEqual(runner.list(), [])
    assert.deepEqual(runner.logs("/delete.auto.js"), [])
    assert.deepEqual(apis.list(), [])
    assert.equal(Fake_Web.opened[0].closed, true)
    assert.deepEqual(deleted, ["/delete.auto.js"])
    await settle()
    assert.deepEqual(runner.list(), [], "late completion cannot resurrect the deleted session")
    await runner.start("/delete.auto.js")
    assert.equal(runner.is_running("/delete.auto.js"), true, "source remains available to run again")
    await runner.stop_all()
})

test("deleting a stopped session also closes windows opened without running its source", async () => {
    const { runner } = setup({})
    runner.open_window("/stopped.auto.js")
    assert.equal(runner.is_running("/stopped.auto.js"), false)
    await runner.remove("/stopped.auto.js")
    assert.equal(Fake_Web.opened[0].closed, true)
    assert.deepEqual(runner.list(), [])
})
