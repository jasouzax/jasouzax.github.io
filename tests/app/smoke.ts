/* Optional real Electron acceptance check; run npm run app:build && npm run test:app on a graphical host. */
import { test } from "node:test"
import assert from "node:assert/strict"
import { _electron } from "playwright"
import { createRequire } from "node:module"
import { resolve } from "node:path"
import { once } from "node:events"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { serve_command } from "../../src/step/serve.ts"

test("Electron opens the desk with isolated native IPC and rejects external navigation", async () => {
    const root = process.cwd(), require = createRequire(resolve(root, "app/package.json"))
    const native_root = await mkdtemp(join(tmpdir(), "jazu-desktop-"))
    await writeFile(join(native_root, "native.txt"), "Native filesystem fixture")
    const server = await serve_command(root, { host: "127.0.0.1", port: "0" })
    if (!server.listening) await once(server, "listening")
    const env: NodeJS.ProcessEnv = { ...process.env, JAZU_APP_ROOT: native_root, JAZU_APP_URL: `http://localhost:${(server.address() as { port: number }).port}/desk` }
    delete env.ELECTRON_RUN_AS_NODE
    let app: Awaited<ReturnType<typeof _electron.launch>> | undefined, old_clipboard: string | undefined
    try {
        app = await _electron.launch({ executablePath: require("electron"), args: [resolve(root, "app")], env: Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined)), timeout: 30000 })
        const page = await app.firstWindow()
        await page.waitForSelector("#desk")
        await page.waitForFunction(() => !document.querySelector("#main-content")?.hasAttribute("inert"))
        assert.equal(await page.evaluate(() => typeof (window as any).require), "undefined")
        const hello = await page.evaluate<string>(`new Promise(resolve => {
            const listener = event => { if (event.data?.direction === "to_page" && event.data.message?.type === "hello") { window.removeEventListener("message", listener); resolve(event.data.message.extension) } }
            window.addEventListener("message", listener)
            window.postMessage({ channel: "jazu-host", direction: "to_host", message: { type: "hello" } }, location.origin)
        })`)
        assert.equal(hello, "electron")
        await page.waitForSelector("[data-native-desktop]", { state: "attached" })
        const rpc = (request: unknown) => page.evaluate<any>(`(${(String.raw`request => new Promise((resolve, reject) => {
            const id = Math.floor(Math.random() * 1000000) + 100000
            const timer = setTimeout(() => { window.removeEventListener("message", listener); reject(new Error("Desktop RPC timeout")) }, 10000)
            const listener = event => {
                if (event.data?.direction !== "to_page" || event.data.message?.type !== "desktop_result" || event.data.message.id !== id) return
                window.removeEventListener("message", listener); clearTimeout(timer); resolve(event.data.message)
            }
            window.addEventListener("message", listener)
            window.postMessage({ channel: "jazu-host", direction: "to_host", message: { type: "desktop", id, request } }, location.origin)
        })`)})(${JSON.stringify(request)})`)
        const native = await rpc({ op: "info" })
        old_clipboard = (await rpc({ op: "clipboard_read" })).result.text
        assert.equal(native.result.root, native_root)
        const read = await rpc({ op: "fs", request: { op: "read", path: "/native.txt", offset: 0, length: 100 } })
        assert.equal(Buffer.from(read.result.data, "base64").toString(), "Native filesystem fixture")
        await rpc({ op: "fs", request: { op: "write", path: "/saved.txt", offset: 0, data: Buffer.from("From Electron").toString("base64"), truncate: true } })
        assert.equal(await readFile(join(native_root, "saved.txt"), "utf8"), "From Electron")
        assert((await rpc({ op: "fs", request: { op: "read", path: "/../outside", offset: 0, length: 10 } })).error)
        assert((await rpc({ op: "fs", request: { op: "remove", path: "/", recursive: true } })).error)
        assert((await rpc({ op: "place", id: "5]; exec bad", rect: { x: 0, y: 0, width: 10, height: 10 } })).error)
        // The file tree uses the same IPC-backed handles as editor save/open, rather than a separate display-only list.
        await page.locator("#head_menu").evaluate(node => node.setAttribute("open", ""))
        await page.locator("[data-native-desktop] > summary").click()
        await page.getByRole("button", { name: "Read clipboard", exact: true }).click()
        await page.locator('[data-native-desktop] textarea').fill("JAZU native clipboard fixture")
        await page.getByRole("button", { name: "Write clipboard", exact: true }).click()
        await page.locator('[data-native-desktop] textarea').fill("")
        await page.getByRole("button", { name: "Read clipboard", exact: true }).click()
        await page.waitForFunction(() => document.querySelector<HTMLTextAreaElement>('[data-native-desktop] textarea')?.value === "JAZU native clipboard fixture")
        await page.locator("#head_menu").evaluate(node => node.removeAttribute("open"))
        const path = page.locator(".desk_wbox_head_path").first()
        await path.fill("file:///native.txt"); await path.press("Enter")
        const editor = page.locator(".desk_wbox_body_text_input").first()
        await editor.waitFor()
        assert.equal(await editor.inputValue(), "Native filesystem fixture")
        await editor.fill("Saved from the native desk editor")
        await page.keyboard.press("Control+s")
        await page.waitForFunction(() => !document.querySelector(".desk_wbox_head_save")?.classList.contains("is_dirty"))
        assert.equal(await readFile(join(native_root, "native.txt"), "utf8"), "Saved from the native desk editor")
        const origin = await page.evaluate(() => location.origin)
        await page.evaluate(() => location.assign("https://example.com"))
        await page.waitForTimeout(300)
        assert.equal(await page.evaluate(() => location.origin), origin)
    } finally {
        if (app) { if (old_clipboard !== undefined) await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), old_clipboard).catch(() => {}); await app.close() }
        await new Promise<void>(resolve => { server.close(() => resolve()); server.closeIdleConnections() })
        await rm(native_root, { recursive: true, force: true })
    }
})
