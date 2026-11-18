import { test } from "node:test"
import assert from "node:assert/strict"
import { Api_Registry, serve_http } from "../src/api.ts"
import type { Api_Owner } from "../src/api.ts"
import type { Api_Call } from "../src/shared/protocol.ts"

function owner(): Api_Owner & { errors: unknown[] } {
    const errors: unknown[] = []
    return { script_id: "/s.auto.js", script_name: () => "s", run: task => task(), report: error => { errors.push(error) }, closed: () => {}, errors }
}
const call = (name: string, patch: Partial<Api_Call> = {}): Api_Call => ({ id: 1, name, method: "GET", path: "", query: {}, headers: {}, body: "", ip: "1.2.3.4", ...patch })
const b64 = (text: string) => Buffer.from(text).toString("base64")
const text_of = (body: string) => Buffer.from(body, "base64").toString()

test("names: reserved, malformed and duplicate names are refused", () => {
    const registry = new Api_Registry()
    for (const bad of ["server", "api", "v1", "a/b", "", "-x"]) assert.throws(() => registry.create(owner(), bad), undefined, bad)
    registry.create(owner(), "sample")
    assert.throws(() => registry.create(owner(), "sample"), /already provided/)
})

test("the registry reports what is published, once per change", () => {
    const registry = new Api_Registry()
    let changes = 0
    registry.on_change = () => { changes++ }
    const a = registry.create(owner(), "b_api", { public: true })
    const b = registry.create(owner(), "a_api")
    assert.deepEqual(registry.list(), [{ name: "a_api", public: false }, { name: "b_api", public: true }])
    registry.remove_all([a, b])
    assert.equal(changes, 3)
    assert.deepEqual(registry.list(), [])
})

test("routes: params, tree, JSON answers, 404 and 405", async () => {
    const registry = new Api_Registry()
    const api = registry.create(owner(), "shop")
    api.get("items", () => [1, 2]).get(":id", (arg: any) => ({ id: arg.id }))
    api.post("items", (arg: any) => ({ got: arg.name }))
    const list = await serve_http(registry, call("shop", { path: "items" }))
    assert.equal(list.status, 200)
    assert.deepEqual(JSON.parse(text_of(list.body)), [1, 2])
    assert.deepEqual(JSON.parse(text_of((await serve_http(registry, call("shop", { path: "items/7" }))).body)), { id: "7" })
    assert.equal((await serve_http(registry, call("shop", { path: "nope" }))).status, 404)
    const wrong = await serve_http(registry, call("shop", { path: "items", method: "DELETE" }))
    assert.equal(wrong.status, 405)
    assert.equal(wrong.headers.allow, "GET, POST")
    assert.equal((await serve_http(registry, call("ghost"))).status, 404)
    assert.equal((await serve_http(registry, call("shop", { method: "TRACE" }))).status, 405)
})

test("bodies: JSON and forms become the argument, bad ones are 400, big ones 413", async () => {
    const registry = new Api_Registry()
    registry.create(owner(), "echo").post("", (arg: any) => arg)
    const post = (body: string, headers: Record<string, string> = {}) => serve_http(registry, call("echo", { method: "POST", body: b64(body), headers }))
    assert.deepEqual(JSON.parse(text_of((await post('{"a":1}')).body)), { a: 1 })
    assert.deepEqual(JSON.parse(text_of((await post("a=1&a=2&b=x", { "content-type": "application/x-www-form-urlencoded" })).body)), { a: ["1", "2"], b: "x" })
    assert.equal((await post("{")).status, 400)
    assert.equal((await post("[1]")).status, 400)
    assert.equal((await post("x".repeat(600 * 1024 + 1))).status, 413)
    assert.equal((await post("   ")).status, 200)
})

test("res.send, redirects and bytes are answered as they are; a throwing handler is a 500 reported to the script", async () => {
    const registry = new Api_Registry()
    const mine = owner()
    const api = registry.create(mine, "pages")
    api.get("home", (_arg, _req, res) => res.html("<b>hi</b>"))
    api.get("go", (_arg, _req, res) => res.redirect("/elsewhere"))
    api.get("bin", () => new Uint8Array([1, 2, 3]))
    api.get("boom", () => { throw new Error("bad") })
    api.get("none", () => undefined)
    const home = await serve_http(registry, call("pages", { path: "home" }))
    assert.equal(home.headers["content-type"], "text/html; charset=utf-8")
    assert.equal(text_of(home.body), "<b>hi</b>")
    const go = await serve_http(registry, call("pages", { path: "go" }))
    assert.deepEqual([go.status, go.headers.location], [302, "/elsewhere"])
    assert.deepEqual([...Buffer.from((await serve_http(registry, call("pages", { path: "bin" }))).body, "base64")], [1, 2, 3])
    assert.equal((await serve_http(registry, call("pages", { path: "boom" }))).status, 500)
    assert.equal(mine.errors.length, 1)
    assert.equal((await serve_http(registry, call("pages", { path: "none" }))).status, 204)
})

test("scripts call each other's APIs directly, and errors reject with the status", async () => {
    const registry = new Api_Registry()
    registry.create(owner(), "friend").get("hello", (arg: any) => ({ hi: arg.who ?? "you" }))
    const client = registry.client("friend")
    assert.deepEqual(await client.get("hello", { who: "me" }), { hi: "me" })
    await assert.rejects(() => client.get("missing"), (error: any) => error.status === 404)
    assert.equal(registry.client("friend").is_running, true)
    assert.equal(registry.client("nobody").is_running, false)
})

test("an answer too big for one frame becomes a 502 instead of vanishing", async () => {
    const registry = new Api_Registry()
    registry.create(owner(), "big").get("", () => "x".repeat(600 * 1024 + 1))
    const answer = await serve_http(registry, call("big"))
    assert.equal(answer.status, 502)
    assert.equal(JSON.parse(text_of(answer.body)).error, "The answer is too large")
    registry.create(owner(), "ok").get("", () => "x".repeat(1000))
    assert.equal((await serve_http(registry, call("ok"))).status, 200)
})
