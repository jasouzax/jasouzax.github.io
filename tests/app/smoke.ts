/* Optional real Electron acceptance check; run npm run app:build && npm run test:app on a graphical host. */
import { test } from "node:test"
import assert from "node:assert/strict"
import { _electron } from "playwright"
import { createRequire } from "node:module"
import { resolve } from "node:path"
import { once } from "node:events"
import { serve_command } from "../../src/step/serve.ts"

test("Electron opens the desk with isolated native IPC and rejects external navigation", async () => {
    const root = process.cwd(), require = createRequire(resolve(root, "app/package.json"))
    const server = await serve_command(root, { host: "127.0.0.1", port: "0" })
    if (!server.listening) await once(server, "listening")
    const env: NodeJS.ProcessEnv = { ...process.env, JAZU_APP_URL: `http://localhost:${(server.address() as { port: number }).port}/desk` }
    delete env.ELECTRON_RUN_AS_NODE
    let app: Awaited<ReturnType<typeof _electron.launch>> | undefined
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
        const origin = await page.evaluate(() => location.origin)
        await page.evaluate(() => location.assign("https://example.com"))
        await page.waitForTimeout(300)
        assert.equal(await page.evaluate(() => location.origin), origin)
    } finally { if (app) await app.close(); await new Promise<void>(resolve => { server.close(() => resolve()); server.closeIdleConnections() }) }
})
