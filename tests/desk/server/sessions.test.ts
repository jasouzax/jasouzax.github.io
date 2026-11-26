import test from "node:test"
import assert from "node:assert/strict"
import { Session_Store, session_description } from "../../../desk/server/sessions_model.ts"
import type { Window_Info } from "../../../shared/protocol/wire.ts"

const win = (id: number, script: string): Window_Info => ({ id, script, title: "", url: "about:blank", icon: "", width: 800, height: 600, devtools: null })
test("sessions keep stopped scripts available to restart and remove only deleted sessions", () => {
    const store = new Session_Store()
    store.apply({ t: "auto_state", scripts: [{ path: "/a.auto.js", running: true }, { path: "/b.auto.js", running: false }] })
    const windows = [win(1, "/a.auto.js"), win(2, "site:x"), win(3, ""), win(4, "/b.auto.js")]
    let sessions = store.list(windows)
    assert.deepEqual(sessions.scripts.map(script => [script.path, script.running, script.windows.map(window => window.id)]), [["/a.auto.js", true, [1]], ["/b.auto.js", false, [4]]])
    assert.deepEqual(sessions.windows.map(window => window.id), [2, 3])
    store.apply({ t: "auto_status", path: "/a.auto.js", running: false })
    sessions = store.list(windows)
    assert.equal(sessions.scripts.length, 2)
    assert.equal(sessions.scripts[0].running, false)
    store.apply({ t: "auto_deleted", path: "/a.auto.js" })
    assert.deepEqual(store.list(windows).scripts.map(script => script.path), ["/b.auto.js"])
    assert.deepEqual(store.list(windows).windows.map(window => window.id), [1, 2, 3])
    store.apply({ t: "auto_status", path: "/new.auto.js", running: true })
    assert.equal(store.list(windows).scripts.at(-1)?.path, "/new.auto.js")
    store.clear()
    assert.equal(store.list([]).scripts.length, 0)
})


test("sessions retain desired-running and pending-restart state across snapshots", () => {
    const store = new Session_Store()
    store.apply({ t: "auto_state", scripts: [{ path: "/a.auto.js", running: false, autostart: true, restarting: true }] })
    assert.equal(store.list([]).scripts[0].autostart, true)
    assert.equal(store.list([]).scripts[0].restarting, true)
    store.apply({ t: "auto_status", path: "/a.auto.js", running: true, autostart: true, restarting: false })
    assert.equal(store.list([]).scripts[0].running, true)
    assert.equal(store.list([]).scripts[0].restarting, false)
    store.apply({ t: "auto_status", path: "/a.auto.js", running: false, autostart: false, restarting: false })
    assert.equal(store.list([]).scripts[0].autostart, false)
})

test("script descriptions use the server start and retry timestamps", () => {
    assert.equal(session_description({ running: true, started_at: 1000 }, 3662000), "Running 1h 1m 1s")
    assert.equal(session_description({ running: false, restarting: true, restart_at: 3500 }, 1000), "Restarting in 3s")
    assert.equal(session_description({ running: false, restarting: true, restart_at: 3500 }, 5000), "Restarting in 0s")
    assert.equal(session_description({ running: false }), "Stopped")
})
