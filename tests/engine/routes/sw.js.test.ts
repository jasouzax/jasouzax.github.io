import { test } from "node:test"
import assert from "node:assert/strict"
import { pwa_files } from "../../../engine/routes/sw.js.ts"
import { default_config } from "../../../shared/config.ts"
import { headers_file } from "../../../engine/seo/head.tsx"

const config = { ...default_config, pwa: { ...default_config.pwa, enabled: true } }
const offline = async (files: Map<string, string | Buffer>, skipped = new Map<string, string | Uint8Array>(), media = new Set<string>()) => {
    await pwa_files(process.cwd(), files, skipped, config, media)
    return JSON.parse(files.get("offline.json") as string) as { version: string, files: string[], bytes: number }
}
const site = () => new Map<string, string | Buffer>([
    ["index.html", "<html>home</html>"], ["ja/index.html", "<html>ja</html>"], ["assets/themes/memory/memory.css", "a{}"],
    ["assets/wasm/busybox.wasm", Buffer.from([0, 97, 115, 109])], ["assets/media/talk.mp4", Buffer.from([1, 2, 3])],
    ["api/v1/x.json", "{}"], ["_headers", "/*"], [".jazu_output.json", "[]"], ["projects/app.git/HEAD", "ref"]
])

test("offline snapshot lists public pages and themes but never private, toolchain, expertise-media or Git outputs", async () => {
    const result = await offline(site(), new Map([["assets/themes/default/default.css", "b{}"]]), new Set(["/assets/media/talk.mp4"]))
    assert.deepEqual(result.files, ["/assets/themes/default/default.css", "/assets/themes/memory/memory.css", "/index.html", "/ja/index.html", "/offline.html"])
    assert.ok(result.bytes > 0)
})

test("snapshot version changes with any byte and the worker is emitted only when enabled", async () => {
    const first = await offline(site()), changed = site(); changed.set("ja/index.html", "<html>ja2</html>")
    assert.notEqual(first.version, (await offline(changed)).version)
    const disabled = new Map<string, string | Buffer>([["index.html", "x"]])
    await pwa_files(process.cwd(), disabled, new Map(), { ...config, pwa: { ...config.pwa, enabled: false } }, new Set())
    assert.equal(disabled.has("service-worker.js"), false)
})

test("online-only desks and prior snapshot metadata never enter offline caches", async () => {
    const files = site()
    for (const path of ["desk/index.html", "desk/tool/index.json", "server/index.html", "work/index.html", "ja/server/index.json", "ja/work/index.html", "service-worker.js", "offline.json"]) files.set(path, "must not cache")
    const result = await offline(files)
    assert.equal(result.files.some(path => /\/(?:desk|server|work)(?:\/|$)/.test(path) || path === "/service-worker.js" || path === "/offline.json"), false)
    assert.match(files.get("offline.html") as string, /Connection required/)
    assert.doesNotMatch(files.get("offline.html") as string, /<script|must not cache/)
})

test("worker bundle embeds the allowlist, notification switch and the Pages-safe canonical install fetch", async () => {
    const files = site(); await offline(files)
    const worker = files.get("service-worker.js") as string
    assert.match(worker, /\/ja\/index\.html/); assert.match(worker, /push/); assert.match(worker, /notificationclick/)
    assert.doesNotMatch(worker, /redirect:"error"/)
})

test("service worker and its snapshot manifest are never cached by the CDN", () => {
    const text = headers_file([], [], "https://example.com")
    assert.match(text, /\/service-worker\.js\n\s+Content-Type: text\/javascript[^\n]*\n\s+Cache-Control: public, max-age=0/)
    assert.match(text, /\/offline\.json\n[^\n]*\n\s+Cache-Control: public, max-age=0/)
})
