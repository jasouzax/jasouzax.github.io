import test from "node:test"
import assert from "node:assert/strict"
import { open_pty_session, type Pty_Link } from "../desk/server/pty.ts"
import { to_base64 } from "../shared/protocol/codec.ts"
import type { Client_Message } from "../shared/protocol/wire.ts"

function link() {
    const sent: Client_Message[] = []
    const handlers = new Map<string, Set<(m: { t: string, [key: string]: unknown }) => void>>()
    const api: Pty_Link & { say(m: { t: string, [key: string]: unknown }): void, count(): number, open: boolean } = {
        open: true,
        send(message) { if (!api.open) return false; sent.push(message); return true },
        on(type, handler) { let set = handlers.get(type); if (!set) handlers.set(type, (set = new Set())); set.add(handler); return () => { set!.delete(handler) } },
        say(message) { for (const handler of [...(handlers.get(message.t) ?? [])]) handler(message) },
        count() { return [...handlers.values()].reduce((sum, set) => sum + set.size, 0) },
    }
    return { api, sent }
}

test("opens with the size, relays input as base64 and output as text, resize and close", () => {
    const { api, sent } = link()
    const out: string[] = []
    const session = open_pty_session(api, 100, 30, chunk => out.push(chunk), () => assert.fail("no exit"))
    const open = sent[0] as { t: string, id: number, cols: number, rows: number }
    assert.deepEqual([open.t, open.cols, open.rows], ["pty_open", 100, 30])
    session.write("ls\r")
    assert.deepEqual(sent[1], { t: "pty_input", id: open.id, data: to_base64(new TextEncoder().encode("ls\r")) })
    session.resize(120, 40)
    assert.deepEqual(sent[2], { t: "pty_resize", id: open.id, cols: 120, rows: 40 })
    api.say({ t: "pty_out", id: open.id, data: to_base64(new TextEncoder().encode("pi@raspberry:~$ ")) })
    api.say({ t: "pty_out", id: open.id + 99, data: to_base64(new TextEncoder().encode("other shell")) })
    assert.deepEqual(out, ["pi@raspberry:~$ "])
    session.close()
    assert.deepEqual(sent[3], { t: "pty_close", id: open.id })
    assert.equal(api.count(), 0)
    session.write("ignored")
    assert.equal(sent.length, 4)
})

test("a multi-byte character split across two chunks stays whole", () => {
    const { api, sent } = link()
    const out: string[] = []
    open_pty_session(api, 80, 24, chunk => out.push(chunk), () => undefined)
    const id = (sent[0] as { id: number }).id
    const bytes = new TextEncoder().encode("日")
    api.say({ t: "pty_out", id, data: to_base64(bytes.slice(0, 2)) })
    api.say({ t: "pty_out", id, data: to_base64(bytes.slice(2)) })
    assert.equal(out.join(""), "日")
})

test("exit, error, a lost link and an offline open each end the session once and release the handlers", async () => {
    for (const ending of ["exit", "err", "lost", "offline"] as const) {
        const { api, sent } = link()
        const done: [number, string | undefined][] = []
        open_pty_session(api, 80, 24, () => undefined, (code, reason) => done.push([code, reason]))
        const id = (sent[0] as { id: number }).id
        if (ending === "exit") api.say({ t: "pty_exit", id, code: 3 })
        if (ending === "err") api.say({ t: "pty_err", id, message: "at most 8 terminals at once" })
        if (ending === "offline") api.say({ t: "status", online: false })
        if (ending === "lost") api.say({ t: "disconnected" })
        api.say({ t: "pty_exit", id, code: 9 })
        assert.equal(done.length, 1, ending)
        assert.equal(api.count(), 0, ending)
        assert.deepEqual(done[0], ending === "exit" ? [3, undefined] : ending === "err" ? [1, "at most 8 terminals at once"] : ending === "offline" ? [1, "The server is offline"] : [1, "The connection to the server was lost"])
    }
    const { api } = link()
    api.open = false
    const done: [number, string | undefined][] = []
    open_pty_session(api, 80, 24, () => undefined, (code, reason) => done.push([code, reason]))
    await Promise.resolve()
    assert.deepEqual(done, [[1, "The server is offline"]])
})
