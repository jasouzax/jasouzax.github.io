import test from "node:test"
import assert from "node:assert/strict"
import { Session_Store } from "../src/web/client/server_sessions_model.ts"
import type { Window_Info } from "../server/src/shared/protocol.ts"

const win = (id: number, script: string): Window_Info => ({ id, script, title: "", url: "about:blank", icon: "", width: 800, height: 600, devtools: null })
test("sessions group running scripts and retain standalone, orphan and stopped-script windows", () => {
    const store = new Session_Store()
    store.apply({ t: "auto_state", scripts: [{ path: "/a.auto.js", running: true }, { path: "/b.auto.js", running: false }] })
    const windows = [win(1, "/a.auto.js"), win(2, "site:x"), win(3, ""), win(4, "/b.auto.js")]
    let sessions = store.list(windows)
    assert.deepEqual(sessions.scripts.map(script => [script.path, script.windows.map(window => window.id)]), [["/a.auto.js", [1]]])
    assert.deepEqual(sessions.windows.map(window => window.id), [2, 3, 4])
    store.apply({ t: "auto_status", path: "/a.auto.js", running: false })
    sessions = store.list(windows)
    assert.equal(sessions.scripts.length, 0)
    assert.equal(sessions.windows.length, 4)
    store.apply({ t: "auto_status", path: "/new.auto.js", running: true })
    assert.equal(store.list(windows).scripts[0].path, "/new.auto.js")
    store.clear()
    assert.equal(store.list([]).scripts.length, 0)
})
