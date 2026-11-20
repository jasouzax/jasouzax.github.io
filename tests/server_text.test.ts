import test from "node:test"
import assert from "node:assert/strict"
import { mode_of, snapshot_text, format_time } from "../src/web/client/server_text.ts"

const strings: Record<string, string> = { server_offline: "Offline.", server_unreachable: "No status.", server_last_snapshot: "Last: {time}" }
const label = (key: string): string => strings[key] ?? key

test("mode: the owner view needs both the owner flag and an online agent", () => {
    assert.equal(mode_of({ online: true, owner: true, snapshot: null, stale: false }), "owner")
    assert.equal(mode_of({ online: true, owner: false, snapshot: null, stale: false }), "public")
    assert.equal(mode_of({ online: false, owner: true, snapshot: null, stale: true }), "offline")
})

test("online: the snapshot with one trailing newline; offline: the notice then the dimmed old snapshot", () => {
    const online = { online: true, owner: false, snapshot: { text: "OS: Debian\nCPU: ARM\n\n", taken_at: 0 }, stale: false }
    assert.equal(snapshot_text(online, false, label), "OS: Debian\nCPU: ARM\n")
    const offline = { online: false, owner: false, snapshot: { text: "OS: Debian", taken_at: Date.UTC(2026, 10, 19, 1, 2, 3) }, stale: true }
    assert.equal(snapshot_text(offline, false, label), "Offline.\n\nLast: 2026-11-19 01:02:03 UTC\n\nOS: Debian\n")
    assert.equal(snapshot_text({ ...offline, snapshot: null }, false, label), "Offline.\n")
})

test("a failed request without any earlier status says the status could not be loaded", () => {
    assert.equal(snapshot_text(null, true, label), "No status.")
    assert.equal(snapshot_text(null, false, label), "")
    assert.equal(format_time(0), "1970-01-01 00:00:00 UTC")
})

import { is_server_page } from "../src/web/client/server_text.ts"
test("only /server and its language form count as the server page", () => {
    for (const path of ["/server", "/server/", "/ja/server"]) assert.equal(is_server_page(path), true, path)
    for (const path of ["/desk", "/servers", "/server/x", "/jap/server", "/api/server", "/"]) assert.equal(is_server_page(path), false, path)
})
