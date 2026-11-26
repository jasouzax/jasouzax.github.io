import { test } from "node:test"
import assert from "node:assert/strict"
import { restart_session } from "../../../desk/server/sessions/control.ts"
import type { Client_Message } from "../../../shared/protocol/wire.ts"
function fixture() {
    const handlers = new Map<string, Set<(message: any) => void>>(), sent: Client_Message[] = []
    return { sent,
        on(name: string, handler: (message: any) => void) { if (!handlers.has(name)) handlers.set(name, new Set()); handlers.get(name)!.add(handler); return () => { handlers.get(name)?.delete(handler) } },
        send(message: Client_Message) { sent.push(message); return true },
        emit(message: { t: string, [key: string]: unknown }) { for (const handler of [...handlers.get(message.t) || []]) handler(message) },
        listeners: () => [...handlers.values()].reduce((n, list) => n + list.size, 0),
    }
}
test("restart waits for a stopped acknowledgement before starting and releases handlers", async () => {
    const link = fixture(), job = restart_session(link, "/a.auto.js")
    assert.deepEqual(link.sent, [{ t: "auto_stop", path: "/a.auto.js" }])
    link.emit({ t: "auto_status", path: "/b.auto.js", running: false })
    link.emit({ t: "auto_status", path: "/a.auto.js", running: true })
    assert.equal(link.sent.length, 1)
    link.emit({ t: "auto_status", path: "/a.auto.js", running: false })
    assert.deepEqual(link.sent[1], { t: "auto_start", path: "/a.auto.js" })
    link.emit({ t: "auto_status", path: "/a.auto.js", running: true }); await job
    assert.equal(link.listeners(), 0)
})
test("deletion and disconnect cancel restart without resurrecting a session", async () => {
    for (const event of [{ t: "auto_deleted", path: "/a.auto.js" }, { t: "disconnected" }]) {
        const link = fixture(), job = restart_session(link, "/a.auto.js")
        link.emit(event); await assert.rejects(job)
        link.emit({ t: "auto_status", path: "/a.auto.js", running: false })
        assert.equal(link.sent.length, 1); assert.equal(link.listeners(), 0)
    }
})
