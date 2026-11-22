import { test } from "node:test"
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { Site_Registry, is_site_url, max_sites, site_script } from "../browser/sites.ts"

class Fake_Web extends EventEmitter {
    closed = false
    constructor(public url: string) { super() }
    async close(): Promise<boolean> { this.closed = true; this.emit("close"); return true }
}

function setup(max?: number) {
    const made: Fake_Web[] = []
    const tracked: { script: string, web: Fake_Web }[] = []
    const registry = new Site_Registry({ make_web: url => { const web = new Fake_Web(url); made.push(web); return web }, windows: { track: (script, web) => tracked.push({ script, web: web as Fake_Web }) }, max })
    return { registry, made, tracked }
}

test("only http(s) and about:blank are sites", () => {
    for (const url of ["https://example.com/a?b=1", "http://127.0.0.1:8080", "about:blank"]) assert.equal(is_site_url(url), true, url)
    for (const url of ["file:///etc/passwd", "javascript:alert(1)", "data:text/html,x", "chrome://gpu", "", "not a url", 5, null]) assert.equal(is_site_url(url), false, String(url))
})

test("opening makes one window tracked as site:<key>, opening again finds it", () => {
    const { registry, made, tracked } = setup()
    assert.equal(registry.open("a", "https://example.com"), true)
    assert.equal(registry.open("a", "https://other.example"), true)
    assert.equal(made.length, 1)
    assert.deepEqual(tracked.map(item => item.script), [site_script("a")])
    assert.equal(made[0].url, "https://example.com")
})

test("bad keys and addresses are refused without opening anything", () => {
    const { registry, made } = setup()
    assert.equal(registry.open("../x", "https://example.com"), false)
    assert.equal(registry.open("a b", "https://example.com"), false)
    assert.equal(registry.open("a", "file:///etc/passwd"), false)
    assert.equal(registry.open(7, "https://example.com"), false)
    assert.equal(made.length, 0)
})

test("the number of windows is capped, and a closed one frees its place", async () => {
    const { registry, made } = setup(2)
    assert.equal(registry.open("a", "about:blank"), true)
    assert.equal(registry.open("b", "about:blank"), true)
    assert.equal(registry.open("c", "about:blank"), false)
    await registry.close("a")
    assert.equal(made[0].closed, true)
    assert.equal(registry.open("c", "about:blank"), true)
    assert.equal(max_sites, 8)
})

test("a window closed by its own tab leaves the registry and the key can open again", async () => {
    const { registry, made } = setup()
    registry.open("a", "https://example.com")
    await made[0].close()
    assert.equal(registry.count, 0)
    assert.equal(registry.open("a", "https://example.com"), true)
    assert.equal(made.length, 2)
})

test("close_all closes everything", async () => {
    const { registry, made } = setup()
    registry.open("a", "about:blank"); registry.open("b", "about:blank")
    await registry.close_all()
    assert.deepEqual(made.map(web => web.closed), [true, true])
    assert.equal(registry.count, 0)
})

test("standalone popups and their descendants are tracked without a script parent", () => {
    const { registry, made, tracked } = setup()
    registry.open("parent", "https://example.com")
    const child = new Fake_Web("https://example.com/popup")
    const grandchild = new Fake_Web("https://example.com/child")
    made[0].emit("popup", child)
    child.emit("popup", grandchild)
    assert.deepEqual(tracked.map(item => item.script), [site_script("parent"), "", ""])
    assert.equal(tracked[1].web, child)
    assert.equal(tracked[2].web, grandchild)
})
