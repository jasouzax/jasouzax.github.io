import test from "node:test"
import assert from "node:assert/strict"
import { Log_Store, log_stamp, count_label, max_log_entries } from "../src/web/client/server_script_model.ts"
import { select_case, plugin_matches, type plugin_info, type plugin_case } from "../src/plugin_types.ts"
import { load_site } from "../src/model.ts"
import { load_config } from "../src/config.ts"
import { new_diagnostics } from "../src/diag.ts"

const line = (id: number, level: "log" | "error" = "log") => ({ id, time: 1000 + id, level, text: `line ${id}` })

test("log store: set replaces, add appends, duplicates of a replayed line are ignored, 1000 lines at most", () => {
    const store = new Log_Store()
    store.set("/a.auto.js", [line(1), line(2)])
    store.add("/a.auto.js", line(2))
    store.add("/a.auto.js", line(3, "error"))
    assert.deepEqual(store.get("/a.auto.js").map(entry => entry.id), [1, 2, 3])
    assert.deepEqual(store.get("/a.auto.js", true).map(entry => entry.id), [3])
    assert.equal(store.has_error("/a.auto.js"), true)
    assert.equal(store.count("/other"), 0)
    for (let id = 10; id < 10 + max_log_entries + 5; id++) store.add("/a.auto.js", line(id))
    assert.equal(store.count("/a.auto.js"), max_log_entries)
    assert.equal(store.get("/a.auto.js")[0].id > 3, true)
    store.clear("/a.auto.js")
    assert.equal(store.count("/a.auto.js"), 0)
})

test("log stamps follow the given offset and counts use the language's templates", () => {
    assert.equal(log_stamp(Date.UTC(2026, 10, 19, 14, 3, 9), 0), "2026-11-19 14:03:09")
    assert.equal(log_stamp(Date.UTC(2026, 10, 19, 14, 3, 9), 480), "2026-11-19 22:03:09")
    assert.equal(count_label(1, "{n} message", "{n} messages"), "1 message")
    assert.equal(count_label(12, "{n} message", "{n} messages"), "12 messages")
    assert.equal(count_label(0, "{n} message", "{n} messages"), "0 messages")
})

// The window's body is the first plugin (default last) whose case accepts the resource: what prepare_plugins does for an ordinary window
async function host_of(mime: string, mode: string, file = true, path = "file:///x"): Promise<string | undefined> {
    const root = process.cwd()
    const model = load_site(root, await load_config(root), new_diagnostics(), new Date("2026-11-19"))
    const plugins = model.plugins.map(node => ({ ...node.attrs, cases: node.children.filter(child => child.tag === "case").map(child => ({ ...child.attrs }) as plugin_case) }) as unknown as plugin_info)
    const item = { mime, path, mode, file: file ? new Blob() : null }
    for (const plugin of plugins.sort((a, b) => Number(a.id === "default") - Number(b.id === "default"))) {
        if (!plugin_matches(plugin, item)) continue
        const entry = select_case(plugin.cases ?? [], item)
        if (entry) return entry.host
    }
    return undefined
}

test("plugins: an automation script is the log view in view mode and the code editor in edit mode; plain JavaScript is unchanged", async () => {
    assert.equal(await host_of("application/auto-javascript", "view"), "auto_script")
    assert.equal(await host_of("application/auto-javascript", "edit"), "text")
    assert.equal(await host_of("text/javascript", "edit"), "text")
    assert.equal(await host_of("text/javascript", "view"), "default")
    assert.equal(await host_of("text/plain", "view"), "text")
})

test("plugins: a site is the live feed in view mode with or without a file, and its file is text in edit mode", async () => {
    assert.equal(await host_of("application/auto-site", "view", true), "auto_site")
    assert.equal(await host_of("application/auto-site", "view", false, "https://example.com"), "auto_site")
    assert.equal(await host_of("application/auto-site", "view", false, "server:window:3"), "auto_site")
    assert.equal(await host_of("application/auto-site", "edit", true), "text")
})
