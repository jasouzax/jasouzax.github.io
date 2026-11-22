import { test } from "node:test"
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { Auto_Start } from "../browser/autostart.ts"
import { Script_Runner } from "../browser/runner.ts"
import { Api_Registry } from "../api/prototype.ts"

class Fake_Web extends EventEmitter {
    async close() { this.emit("close"); return true }
}
const wait = (ms = 25) => new Promise(resolve => setTimeout(resolve, ms))
async function until(check: () => boolean) {
    for (let i = 0; i < 100; i++) { if (check()) return; await wait(5) }
    assert.ok(check(), "condition timed out")
}
function fixture(t: any, read: (file: string) => Promise<string>) {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "jazu-autostart-"))
    const file = path.join(folder, "autostart.json")
    const script = path.join(folder, "service.auto.js")
    const runners: Script_Runner[] = []
    const create = () => {
        const store = new Auto_Start(file)
        const runner = new Script_Runner({ root: process.cwd(), read_source: read, apis: new Api_Registry(), web_class: Fake_Web as any, catch_stray: false, autostart: store, restart_min_ms: 15, restart_max_ms: 40 })
        runners.push(runner)
        return { runner, store }
    }
    t.after(async () => { await Promise.all(runners.map(runner => runner.shutdown())); fs.rmSync(folder, { recursive: true, force: true }) })
    return { create, file, script }
}

test("running intent survives shutdown and a new runner, while Stop removes it", async t => {
    let reads = 0
    const f = fixture(t, async () => { reads++; return "setInterval(() => {}, 100000)" })
    const first = f.create()
    await first.runner.start(f.script)
    assert.deepEqual(new Auto_Start(f.file).list(), [f.script])
    await first.runner.shutdown()
    const second = f.create()
    await second.runner.restore()
    assert.equal(second.runner.is_running(f.script), true)
    assert.equal(reads, 2)
    await second.runner.stop(f.script)
    assert.deepEqual(new Auto_Start(f.file).list(), [])
    const third = f.create(); await third.runner.restore()
    assert.equal(reads, 2)
})

test("normal completion, including an async final timer, removes saved intent", async t => {
    const f = fixture(t, async () => "setTimeout(async () => { await sleep(40); console.log('finished') }, 1)")
    const { runner, store } = f.create()
    await runner.start(f.script)
    await wait(15)
    assert.equal(store.has(f.script), true)
    assert.equal(runner.is_running(f.script), true)
    await until(() => !runner.is_running(f.script))
    assert.equal(store.has(f.script), false)
    assert.ok(runner.logs(f.script).some(entry => entry.text === "finished"))
})

for (const [name, source] of [["runtime", "throw new Error('failed')"], ["syntax", "let = = 1"], ["async timer", "setTimeout(async () => { await sleep(1); throw new Error('timer failed') }, 1)"]] as const) {
    test(`${name} failures retry and can be stopped during backoff`, async t => {
        let reads = 0
        const f = fixture(t, async () => { reads++; return source })
        const { runner, store } = f.create()
        await runner.start(f.script)
        await until(() => reads >= 3 && runner.list()[0]?.restarting === true)
        assert.equal(store.has(f.script), true)
        const delays = runner.logs(f.script).filter(entry => entry.text.startsWith("Restarting in")).map(entry => entry.text)
        assert.deepEqual(delays.slice(0, 3), ["Restarting in 15 ms", "Restarting in 30 ms", "Restarting in 40 ms"])
        await runner.stop(f.script)
        const count = reads
        await wait(70)
        assert.equal(reads, count)
        assert.equal(store.has(f.script), false)
        assert.equal(runner.list()[0].restarting, false)
    })
}

test("unreadable scripts remain visible and retry, and Delete cancels them", async t => {
    let reads = 0
    const f = fixture(t, async () => { reads++; throw new Error("ENOENT") })
    const { runner } = f.create()
    await runner.start(f.script)
    assert.equal(runner.list()[0].restarting, true)
    await until(() => reads >= 2)
    await runner.remove(f.script)
    const count = reads
    await wait(60)
    assert.equal(reads, count)
    assert.deepEqual(runner.list(), [])
    assert.deepEqual(new Auto_Start(f.file).list(), [])
})

test("Stop cancels an in-flight source read without resurrecting it", async t => {
    let resolve!: (source: string) => void
    const f = fixture(t, () => new Promise(done => { resolve = done }))
    const { runner } = f.create()
    const starting = runner.start(f.script)
    await runner.stop(f.script)
    resolve("setInterval(() => {}, 100000)")
    await starting
    assert.equal(runner.is_running(f.script), false)
    assert.deepEqual(new Auto_Start(f.file).list(), [])
})

test("a failed retry can recover and then finish normally", async t => {
    let reads = 0
    const f = fixture(t, async () => ++reads < 2 ? "throw Error('transient')" : "console.log('recovered')")
    const { runner, store } = f.create()
    await runner.start(f.script)
    await until(() => reads === 2 && !store.has(f.script))
    assert.ok(runner.logs(f.script).some(entry => entry.text === "recovered"))
})

test("corrupt restart files are rejected instead of silently erased", t => {
    const f = fixture(t, async () => "")
    fs.writeFileSync(f.file, '{"version":1,"scripts":[42]}')
    assert.throws(() => new Auto_Start(f.file), /Invalid/)
    assert.equal(fs.readFileSync(f.file, "utf8"), '{"version":1,"scripts":[42]}')
})
