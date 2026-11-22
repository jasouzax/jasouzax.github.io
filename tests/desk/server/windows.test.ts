import test from "node:test"
import assert from "node:assert/strict"
import { Window_Store, site_key, site_url_of, is_site_url, window_uri, window_id_of } from "../../../desk/server/windows.ts"
import { site_key_pattern } from "../../../server/browser/sites.ts"
import type { Window_Info } from "../../../shared/protocol/wire.ts"

const win = (id: number, script: string, extra: Partial<Window_Info> = {}): Window_Info => ({ id, script, title: `w${id}`, url: "https://x", icon: "", width: 800, height: 600, devtools: null, ...extra })

test("site keys are valid for the agent, stable and different per URL", () => {
    const urls = ["https://example.com", "https://example.com/", "http://127.0.0.1:3000/a?b=c#d", "https://日本語.jp/パス"]
    const keys = urls.map(site_key)
    for (const key of keys) assert.match(key, site_key_pattern)
    assert.equal(new Set(keys).size, urls.length)
    assert.equal(site_key(urls[0]), site_key(urls[0]))
})

test("a site file holds one URL, comments and blank lines are skipped, anything else is not a site", () => {
    assert.equal(site_url_of("\n# my feed\nhttps://example.com/x\nignored"), "https://example.com/x")
    assert.equal(site_url_of("example.com"), null)
    assert.equal(site_url_of("javascript:alert(1)"), null)
    assert.equal(site_url_of("file:///etc/passwd"), null)
    assert.equal(site_url_of(""), null)
    assert.equal(is_site_url("http://localhost:8080"), true)
    assert.equal(is_site_url("ftp://x"), false)
})

test("window uris round trip and reject anything else", () => {
    assert.equal(window_uri(7), "server:window:7")
    assert.equal(window_id_of(" server:window:7 "), 7)
    for (const bad of ["server:window:", "server:window:-1", "server:window:x", "server:sh", "https://x"]) assert.equal(window_id_of(bad), null, bad)
})

test("the store follows the agent's messages and answers by id, site key, script and DevTools picture", () => {
    const store = new Window_Store()
    let changes = 0
    store.on_change(() => { changes++ })
    store.apply({ t: "windows", windows: [win(1, "/a.auto.js"), win(2, "site:u-abc")] })
    store.apply({ t: "window_added", window: win(3, "/a.auto.js", { devtools: { id: 30, width: 500, height: 300 } }) })
    assert.deepEqual(store.of_script("/a.auto.js").map(window => window.id), [1, 3])
    assert.equal(store.of_site("u-abc")?.id, 2)
    assert.equal(store.picture(30)?.width, 500)
    assert.equal(store.picture(30)?.owner.id, 3)
    assert.equal(store.picture(1)?.height, 600)
    store.apply({ t: "window_updated", window: win(1, "/a.auto.js", { title: "new" }) })
    assert.equal(store.get(1)?.title, "new")
    store.apply({ t: "window_removed", id: 2 })
    store.apply({ t: "window_removed", id: 99 })
    store.apply({ t: "other" })
    assert.equal(store.of_site("u-abc"), undefined)
    assert.equal(changes, 4)
    store.clear()
    assert.equal(store.all().length, 0)
    assert.equal(changes, 5)
})
