import { join } from "node:path"
import { test } from "node:test"
import assert from "node:assert/strict"
import { Pty_Channel, max_sessions } from "../src/pty_channel.ts"
import type { Open_Pty } from "../src/pty_channel.ts"
import { open_pty, pick_backend } from "../src/pty.ts"
import { from_base64, to_base64 } from "../../shared/protocol/codec.ts"

function fake() {
    const sent: { message: any, to: string }[] = []
    const opened: { options: any, events: any, written: Buffer[], closed: boolean, resized: number[][] }[] = []
    const open: Open_Pty = (options, events) => {
        const record = { options, events, written: [] as Buffer[], closed: false, resized: [] as number[][] }
        opened.push(record)
        return { write: data => record.written.push(data), resize: (cols, rows) => record.resized.push([cols, rows]), pause: () => {}, resume: () => {}, close: () => { record.closed = true; events.on_exit(129) } }
    }
    const channel = new Pty_Channel({ shim: "/x/pty_shim.py", send: (message, to) => { sent.push({ message, to }); return true }, buffered: () => 0, open, backend: "python", shell: "/bin/sh", home: "/tmp" })
    return { channel, sent, opened }
}

test("open starts the account's shell with a clamped size, in an existing absolute folder only", () => {
    const { channel, opened } = fake()
    channel.handle({ t: "pty_open", id: 1, cols: 9999, rows: -3, cwd: "relative", peer: "p" })
    channel.handle({ t: "pty_open", id: 2, cols: 100, rows: 30, cwd: "/", peer: "p" })
    assert.equal(opened[0].options.cols, 500)
    assert.equal(opened[0].options.rows, 1)
    assert.equal(opened[0].options.cwd, "/tmp")
    assert.equal(opened[1].options.cwd, "/")
    assert.equal(opened[0].options.shell, "/bin/sh")
    assert.equal(opened[0].options.shim, "/x/pty_shim.py")
})

test("input and output travel as base64 and reach only the owning page", () => {
    const { channel, opened, sent } = fake()
    channel.handle({ t: "pty_open", id: 7, cols: 80, rows: 24, peer: "a" })
    channel.handle({ t: "pty_input", id: 7, data: to_base64(Uint8Array.of(3, 0xe3, 0x81)), peer: "a" })
    channel.handle({ t: "pty_input", id: 7, data: "x", peer: "other" })
    assert.deepEqual([...opened[0].written[0]], [3, 0xe3, 0x81])
    assert.equal(opened[0].written.length, 1)
    opened[0].events.on_data(Buffer.from("hi"))
    assert.deepEqual(sent.at(-1), { message: { t: "pty_out", id: 7, data: to_base64(new TextEncoder().encode("hi")) }, to: "a" })
    channel.handle({ t: "pty_resize", id: 7, cols: 120, rows: 40, peer: "a" })
    assert.deepEqual(opened[0].resized, [[120, 40]])
})

test("close and drop_peer end shells and report the exit code", () => {
    const { channel, sent } = fake()
    channel.handle({ t: "pty_open", id: 1, cols: 80, rows: 24, peer: "a" })
    channel.handle({ t: "pty_open", id: 2, cols: 80, rows: 24, peer: "b" })
    channel.handle({ t: "pty_close", id: 1, peer: "a" })
    assert.deepEqual(sent.at(-1), { message: { t: "pty_exit", id: 1, code: 129 }, to: "a" })
    channel.drop_peer("b")
    assert.equal(channel.count, 0)
})

test("at most eight shells, and duplicate ids are refused", () => {
    const { channel, sent } = fake()
    for (let id = 0; id < max_sessions; id++) channel.handle({ t: "pty_open", id, cols: 80, rows: 24, peer: "a" })
    channel.handle({ t: "pty_open", id: 99, cols: 80, rows: 24, peer: "a" })
    assert.equal(sent.at(-1)!.message.t, "pty_err")
    channel.handle({ t: "pty_open", id: 0, cols: 80, rows: 24, peer: "a" })
    assert.equal(sent.length, 2)
    assert.equal(channel.count, max_sessions)
})

test("a real shell on a real pty echoes input and reports its exit", { skip: (() => { try { pick_backend(); return false } catch { return "no pty backend" } })() }, async () => {
    let output = ""
    const done = new Promise<number>(resolve => {
        const session = open_pty({ cols: 80, rows: 24, cwd: "/tmp", shell: "/bin/sh", env: { ...process.env, TERM: "dumb" }, backend: pick_backend(), shim: new URL("../assets/pty_shim.py", import.meta.url).pathname }, { on_data: chunk => { output += chunk.toString() }, on_exit: resolve })
        session.write(Buffer.from("echo jazu-$((20+22))\nexit 3\n"))
    })
    assert.equal(await done, 3)
    assert.match(output, /jazu-42/)
    void from_base64
})


test("bash loads the terminal rcfile while other account shells retain their own startup", () => {
    const opened: any[] = []
    const channel = new Pty_Channel({ shim: "/app/assets/pty_shim.py", send: () => true, buffered: () => 0, backend: "python", shell: "/bin/bash", home: "/tmp", open: (options) => { opened.push(options); return { write() {}, resize() {}, close() {}, pause() {}, resume() {} } } })
    channel.handle({ t: "pty_open", id: 1, cols: 80, rows: 24, peer: "owner" })
    assert.deepEqual(opened[0].shell_args, ["--rcfile", join("/app/assets", "terminal.bashrc"), "-i"])
    assert.equal(opened[0].env.HOME, "/tmp")
})
