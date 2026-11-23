import type { WebSocketRoute } from "@playwright/test"
import { test, expect, type Page } from "./desk_fixture.ts"
import type { Window_Info } from "../shared/protocol/wire.ts"

async function owner(page: Page, stale_plugins = false) {
    const messages: any[] = []
    let socket: WebSocketRoute
    let script_present = true, script_running = true
    const windows: Window_Info[] = [
        { id: 1, script: "/run.auto.js", title: "Script page", url: "https://example.com/start", icon: "", width: 800, height: 600, devtools: null },
        { id: 2, script: "site:standalone", title: "Standalone page", url: "https://example.com/standalone", icon: "", width: 800, height: 600, devtools: null },
        { id: 3, script: "", title: "Orphan popup", url: "https://example.com/popup", icon: "", width: 800, height: 600, devtools: null },
    ]
    const histories = new Map(windows.map(window => [window.id, { urls: [window.url], index: 0 }]))
    const files: Record<string, string> = { "/run.auto.js": "console.log('running'); setInterval(() => {}, 1000)", "/bookmark.auto.site": "https://example.com/bookmark" }
    let jpeg = Buffer.alloc(0)
    const send = (message: object) => socket.send(JSON.stringify(message))
    const frame = (id: number) => {
        if (!jpeg.length) return
        const bytes = Buffer.alloc(5 + jpeg.length); bytes[0] = 1; bytes.writeUInt32BE(id, 1); jpeg.copy(bytes, 5); socket.send(bytes)
    }
    const update = (id: number, url: string, delta?: number) => {
        const window = windows.find(window => window.id === id)!
        const history = histories.get(id) ?? { urls: [window.url], index: 0 }
        histories.set(id, history)
        if (delta) history.index = Math.max(0, Math.min(history.urls.length - 1, history.index + delta))
        else if (url !== history.urls[history.index]) { history.urls.splice(history.index + 1); history.urls.push(url); history.index++ }
        window.url = history.urls[history.index]; window.can_back = history.index > 0; window.can_forward = history.index < history.urls.length - 1
        send({ t: "window_updated", window })
    }
    if (stale_plugins) await page.route("**/assets/plugins.json", async route => {
        const response = await route.fetch()
        const plugins = (await response.json()).filter((plugin: any) => plugin.id !== "auto_site")
        for (const plugin of plugins) if (plugin.id === "mirror") plugin.cases = plugin.cases.filter((entry: any) => entry.host !== "auto_site")
        await route.fulfill({ json: plugins })
    })
    await page.route("**/api/_/server", route => route.fulfill({ json: { online: true, owner: true, stale: false, snapshot: { text: "Test Pi", taken_at: Date.now() } } }))
    await page.routeWebSocket("**/api/_/server/ws", route => {
        socket = route
        route.send(JSON.stringify({ t: "welcome", peer: "test", online: true }))
        route.onMessage(raw => {
            if (raw === "ping") return route.send("pong")
            const message = JSON.parse(String(raw)); messages.push(message)
            if (message.t === "auto_state") { send({ t: "auto_state", scripts: script_present ? [{ path: "/run.auto.js", running: script_running, windows: 1 }] : [] }); send({ t: "windows", windows }) }
            if (message.t === "pty_open") send({ t: "pty_out", id: message.id, data: Buffer.from("jason@jasouza:/home/jason$ ").toString("base64") })
            if (message.t === "pty_input") {
                const input = Buffer.from(message.data, "base64").toString()
                send({ t: "pty_out", id: message.id, data: Buffer.from(input === "\x03" ? "^C\r\njason@jasouza:/home/jason$ " : input.includes("\r") ? "\r\nPi stdout\r\nPi stderr\r\nbash: fastfetch: command not found\r\njason@jasouza:/home/jason$ " : input).toString("base64") })
            }
            if (message.t === "auto_logs") send({ t: "auto_logs", path: message.path, entries: [] })
            if (message.t === "fastfetch") send({ t: "fastfetch", text: "Test Pi", taken_at: Date.now() })
            if (message.t === "fs") {
                let result: any = { op: message.op }
                if (message.op === "list") result.entries = message.path === "/" ? Object.keys(files).map(path => ({ name: path.slice(1), kind: "file", size: files[path].length, mtime: 0 })) : []
                if (message.op === "stat") {
                    if (!(message.path in files) && message.path !== "/") return send({ t: "fs_err", id: message.id, code: "ENOENT", message: "Not found" })
                    result.stat = { kind: message.path in files ? "file" : "dir", size: files[message.path]?.length ?? 0, mtime: 0, mode: 0o755, writable: true }
                }
                if (message.op === "read") { const data = files[message.path] ?? ""; result = { op: "read", data: Buffer.from(data).toString("base64"), size: data.length, eof: true } }
                send({ t: "fs_ok", id: message.id, result })
            }
            if (message.t === "site_open") {
                const window: Window_Info = { ...windows[0], id: 4, script: `site:${message.key}`, title: "Bookmark page", url: message.url, devtools: null }
                windows.push(window); send({ t: "window_added", window })
            }
            if (message.t === "window_navigate") update(message.id, message.url || "", message.delta)
            if (message.t === "window_devtools") {
                const window = windows.find(window => window.id === message.id)!
                window.devtools = message.open ? { id: window.id + 100, width: 800, height: 360 } : null
                send({ t: "window_updated", window }); setTimeout(() => { if (window.devtools) frame(window.devtools.id) }, 40)
            }
            if (message.t === "feed_watch" && message.id !== null) {
                const window = windows.find(window => window.id === message.id)
                setTimeout(() => { frame(message.id); if (window?.devtools) frame(window.devtools.id) }, 30)
            }
            if (message.t === "window_close") { const index = windows.findIndex(window => window.id === message.id); windows.splice(index, 1); send({ t: "window_removed", id: message.id }) }
            if (message.t === "auto_stop" || message.t === "auto_start") {
                script_present = true; script_running = message.t === "auto_start"
                send({ t: "auto_status", path: message.path, running: script_running })
            }
            if (message.t === "auto_delete") {
                script_present = false; script_running = false
                for (const window of [...windows]) if (window.script === message.path) { windows.splice(windows.indexOf(window), 1); send({ t: "window_removed", id: window.id }) }
                send({ t: "auto_deleted", path: message.path })
            }
        })
    })
    await page.goto("/server")
    jpeg = Buffer.from(await page.evaluate(() => { const canvas = document.createElement("canvas"); canvas.width = 8; canvas.height = 8; canvas.getContext("2d")!.fillRect(0, 0, 8, 8); return canvas.toDataURL("image/jpeg").split(",")[1] }), "base64")
    await expect.poll(() => messages.some(message => message.t === "auto_state")).toBe(true)
    return { messages, update, send, windows, frame }
}
async function sessions(page: Page) {
    await page.locator("#head_menu > summary").click()
    await page.locator('.desk_side_tabs_drop[data-path="server:sessions"] > summary').click()
    return page.locator('.desk_side_page[data-path="server:sessions"]')
}

test("Sessions groups scripts and opens sites, scripts and orphan windows in view mode", async ({ page }) => {
    const api = await owner(page), panel = await sessions(page)
    await expect(panel.locator(".server_session_script")).toHaveCount(1)
    await expect(panel.locator('.server_session_script [data-session-uri="server:window:1"]')).toHaveText("Script page")
    await expect(panel.locator(':scope > .server_session_site')).toHaveCount(2)
    await panel.locator('[data-session-uri="file:///run.auto.js"]').click()
    const script = page.locator('.desk_wbox').last()
    await expect(script).toHaveAttribute("data-plugin", "auto_script")
    await script.locator('[data-mode="edit"]').click()
    await panel.locator('[data-session-uri="file:///run.auto.js"]').click()
    await expect(script.locator('[data-mode="view"]')).toBeChecked()
    await panel.locator('[data-session-uri="server:window:3"]').click()
    const popup = page.locator('.desk_wbox').last()
    await expect(popup.locator(".server_site_canvas")).toBeVisible()
    await expect(popup.locator('[data-mode="view"]')).toBeChecked()
    await expect(popup.locator(".server_site_bar")).toHaveCount(0)
    await panel.locator('[data-session-uri="server:window:2"]').click()
    const standalone = page.locator('.desk_wbox').last()
    await expect(standalone.locator(".server_site_canvas")).toBeVisible()
    await page.keyboard.press("Control+Shift+Enter")
    await expect(panel.locator('[data-session-uri="server:window:2"]')).toBeVisible()
    expect(api.messages.some(message => message.t === "site_close")).toBe(false)
    await panel.locator('[data-session-uri="server:window:2"]').click()
    await panel.locator('.server_session_site').filter({ has: page.locator('[data-session-uri="server:window:2"]') }).locator('[data-session-action="delete"]').click()
    await expect(panel.locator('[data-session-uri="server:window:2"]')).toHaveCount(0)
    await api.send({ t: "auto_status", path: "/run.auto.js", running: false })
    await expect(panel.locator('.server_session_script')).toHaveAttribute('data-running', 'false')
    await expect(panel.locator('.server_session_script [data-session-action="start"]')).toBeVisible()
})

test("site headers follow page navigation and Edit shows DevTools in the same pane", async ({ page }) => {
    const api = await owner(page), panel = await sessions(page)
    await panel.locator('[data-session-uri="server:window:1"]').click()
    const pane = page.locator('.desk_wbox').last(), address = pane.locator('.desk_wbox_head_path')
    await expect(pane.locator('.server_site_canvas')).toBeVisible()
    await expect(address).toHaveValue('https://example.com/start')
    api.update(1, 'https://example.com/clicked')
    await expect(address).toHaveValue('https://example.com/clicked')
    await expect(pane.locator('[data-navigation="previous"]')).toBeEnabled()
    await pane.locator('[data-navigation="previous"]').click()
    await expect(address).toHaveValue('https://example.com/start')
    await pane.locator('[data-navigation="forward"]').click()
    await expect(address).toHaveValue('https://example.com/clicked')
    await address.fill('https://example.com/typed'); await address.press('Enter')
    await expect(address).toHaveValue('https://example.com/typed')
    await pane.locator('[data-navigation="refresh"]').click()
    expect(api.messages.filter(message => message.t === 'window_navigate').at(-1).delta).toBe(0)
    const count = await page.locator('.desk_wbox').count()
    await pane.locator('[data-mode="edit"]').click()
    await expect.poll(() => api.messages.some(message => message.t === 'window_devtools' && message.id === 1 && message.open)).toBe(true)
    await expect(pane.locator('.server_site_canvas')).toBeVisible()
    await expect(pane.locator('.desk_wbox_body_text')).toHaveCount(0)
    await expect(page.locator('.desk_wbox')).toHaveCount(count)
    await pane.locator('[data-mode="view"]').click()
    await expect(pane.locator('.server_site_canvas')).toBeVisible()
    await pane.locator('.desk_wbox_head_audio').click()
    await expect(pane.locator('.desk_wbox_head_audio')).toHaveAttribute('aria-pressed', 'false')
    await expect.poll(() => api.messages.filter(message => message.t === 'feed_watch' && message.id === 1).at(-1)?.audio).toBe(false)
})

test("every window groups volume and save, with fullscreen between split and move", async ({ page }) => {
    await page.goto('/desk')
    const pane = page.locator('.desk_wbox').first(), head = pane.locator('.desk_wbox_head')
    expect(await head.locator('.desk_wbox_head_actions > button').evaluateAll(buttons => buttons.map(button => button.className.split(' ').at(-1)))).toEqual(['desk_wbox_head_audio', 'desk_wbox_head_save'])
    expect(await head.locator(':scope > .desk_wbox_head_split, :scope > .desk_wbox_head_fullscreen, :scope > .desk_wbox_head_drop').evaluateAll(buttons => buttons.map(button => button.className.split(' ').at(-1)))).toEqual(['desk_wbox_head_split', 'desk_wbox_head_fullscreen', 'desk_wbox_head_drop'])
    await expect(pane.locator('.desk_wbox_head_audio')).toBeDisabled()
    await pane.locator('[data-mode="edit"]').click()
    await expect(pane.locator('.desk_wbox_head_audio')).toBeDisabled()
    await pane.locator('.desk_wbox_head_fullscreen').click()
    await expect.poll(() => page.evaluate(() => document.fullscreenElement?.classList.contains('desk_wbox'))).toBe(true)
    await pane.locator('.desk_wbox_head_fullscreen').click()
    await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true)
    for (const width of [320, 390, 768]) {
        await page.setViewportSize({ width, height: 1000 })
        for (const name of ['fullscreen', 'audio', 'save']) await expect(pane.locator(`.desk_wbox_head_${name}`)).toBeVisible()
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    }
    await page.screenshot({ path: '.cache/desk-browser-results/server-header-portrait.png' })
})


test("remote browser audio reports a muted activity badge and accepts header volume", async ({ page }) => {
    const api = await owner(page), panel = await sessions(page)
    await panel.locator('[data-session-uri="server:window:1"]').click()
    const pane = page.locator('.desk_wbox').last(), volume = pane.locator('.desk_wbox_head_audio')
    await expect(volume).toBeEnabled()
    await volume.click()
    api.send({ t: "window_updated", window: { ...api.windows[0], audible: true } })
    await expect(volume).toHaveAttribute('data-muted-playing', '')
    await volume.click({ button: 'right' })
    await page.locator('.desk_volume_popup:not([hidden]) input').fill('0.25')
    await expect(volume).toHaveAttribute('aria-pressed', 'true')
    await expect(volume).not.toHaveAttribute('data-muted-playing', '')
    await page.keyboard.press('Escape')
})

test("an auto-site file switches between its page and DevTools without opening a second session", async ({ page }) => {
    const api = await owner(page)
    const pane = page.locator('.desk_wbox').first(), address = pane.locator('.desk_wbox_head_path')
    await address.fill('file:///bookmark.auto.site'); await address.press('Enter')
    await expect(pane).toHaveAttribute('data-plugin', 'auto_site')
    await expect(pane.locator('.server_site_canvas')).toBeVisible()
    await expect(address).toHaveValue('https://example.com/bookmark')
    await pane.locator('[data-mode="edit"]').click()
    await expect.poll(() => api.messages.some(message => message.t === 'window_devtools' && message.id === 4 && message.open)).toBe(true)
    await expect(pane.locator('.server_site_canvas')).toBeVisible()
    await expect(pane.locator('.desk_wbox_body_text_input')).toHaveCount(0)
    await pane.locator('[data-mode="view"]').click()
    await expect(pane.locator('.server_site_canvas')).toBeVisible()
    expect(api.messages.filter(message => message.t === 'site_open')).toHaveLength(1)
    const panel = await sessions(page)
    await expect(panel.locator('[data-session-uri="server:window:4"]')).toBeVisible()
    await panel.locator('[data-session-uri="server:window:4"]').click()
    await panel.locator('.server_session_site').filter({ has: page.locator('[data-session-uri="server:window:4"]') }).locator('[data-session-action="delete"]').click()
    await expect(panel.locator('[data-session-uri="server:window:4"]')).toHaveCount(0)
    await expect(pane.locator('.server_site_feed')).toHaveAttribute('data-state', 'This window is closed.')
    expect(api.messages.filter(message => message.t === 'site_open')).toHaveLength(1)
    await page.screenshot({ path: '.cache/desk-browser-results/server-site-view.png' })
})


test("a frame decoded after remote closure cannot revive the closed feed", async ({ page }) => {
    const api = await owner(page)
    const pane = page.locator('.desk_wbox').first(), address = pane.locator('.desk_wbox_head_path')
    await address.fill('server:window:1'); await address.press('Enter')
    await expect(pane.locator('.server_site_canvas')).toBeVisible()
    await page.evaluate(() => {
        const decode = window.createImageBitmap.bind(window)
        ;(window as any).held_frames = []
        window.createImageBitmap = (async (...args: any[]) => {
            const bitmap = await (decode as any)(...args)
            await new Promise<void>(resolve => (window as any).held_frames.push(resolve))
            return bitmap
        }) as typeof createImageBitmap
    })
    api.frame(1)
    await expect.poll(() => page.evaluate(() => (window as any).held_frames.length)).toBeGreaterThan(0)
    api.send({ t: 'window_removed', id: 1 })
    await expect(pane.locator('.server_site_feed')).toHaveAttribute('data-state', 'This window is closed.')
    await page.evaluate(() => { for (const release of (window as any).held_frames.splice(0)) release() })
    await page.waitForTimeout(100)
    await expect(pane.locator('.server_site_feed')).toHaveAttribute('data-state', 'This window is closed.')
    await expect(pane.locator('.server_site_canvas')).toBeHidden()
})

test("Sessions use standard side items with icons and persistent script actions", async ({ page }) => {
    const api = await owner(page), panel = await sessions(page)
    const script = panel.locator('.server_session_script')
    await expect(script).toHaveClass(/desk_side_item/)
    await expect(script.locator(':scope > .desk_side_item_box > .desk_side_item_head > .desk_side_item_icon')).not.toBeEmpty()
    await expect(script.locator(':scope > .desk_side_item_box > .desk_side_item_tool')).toBeVisible()
    await script.locator('[data-session-action="stop"]').click()
    await expect(script).toHaveAttribute('data-running', 'false')
    await script.locator('[data-session-action="start"]').click()
    await expect(script).toHaveAttribute('data-running', 'true')
    expect(api.messages.some(message => message.t === 'auto_start' && message.path === '/run.auto.js')).toBe(true)
    await script.locator('[data-session-action="clear"]').click()
    expect(api.messages.some(message => message.t === 'auto_clear_logs' && message.path === '/run.auto.js')).toBe(true)
    const standalone = panel.locator('.server_session_site').filter({ has: page.locator('[data-session-uri="server:window:2"]') })
    await standalone.locator('[data-session-uri]').click()
    await expect(standalone).toHaveClass(/desk_side_item/)
    await expect(standalone.locator('.desk_side_item_icon')).not.toBeEmpty()
    await expect(standalone.locator('.desk_side_item_tool button')).toHaveCount(1)
    await expect(standalone.locator('[data-session-action="delete"]')).toHaveAccessibleName('Delete')
    await script.locator(':scope > .desk_side_item_box > .desk_side_item_tool [data-session-action="delete"]').click()
    await expect(script).toHaveCount(0)
    expect(api.messages.some(message => message.t === 'auto_delete' && message.path === '/run.auto.js')).toBe(true)
    // A snapshot after deletion must not bring the forgotten session back.
    await page.locator('.desk_wbox').first().locator('.desk_wbox_head_path').fill('file:///run.auto.js')
    await page.locator('.desk_wbox').first().locator('.desk_wbox_head_path').press('Enter')
    await expect(page.locator('.desk_wbox').first()).toHaveAttribute('data-plugin', 'auto_script')
    await expect(script).toHaveCount(0)
    await page.screenshot({ path: '.cache/desk-browser-results/server-sessions-side-items.png' })
})

test("splitting an auto-site opens its developer tools beside the original page", async ({ page }) => {
    const api = await owner(page)
    const parent = page.locator('.desk_wbox').first(), address = parent.locator('.desk_wbox_head_path')
    await address.fill('file:///bookmark.auto.site'); await address.press('Enter')
    await expect(parent.locator('.server_site_canvas')).toBeVisible()
    await parent.locator('.desk_wbox_head_split').click()
    const child = page.locator('.desk_wbox').nth(1)
    await expect(child.locator('[data-mode][aria-checked="true"]')).toHaveCount(0)
    await child.locator('[data-mode="edit"]').click()
    await expect.poll(() => api.messages.some(message => message.t === 'window_devtools' && message.id === 4 && message.open)).toBe(true)
    await expect(child.locator('.server_site_canvas')).toBeVisible()
    await expect(parent.locator('.server_site_canvas')).toBeVisible()
    await expect(parent.locator('[data-mode="view"]')).toBeChecked()
    await expect(child.locator('[data-mode="edit"]')).toBeChecked()
    await expect(child.locator('.desk_wbox_head_path')).toHaveValue('https://example.com/bookmark')
    await child.locator('.server_site_canvas').click()
    await expect.poll(() => api.messages.some(message => message.t === 'window_input' && message.id === 104)).toBe(true)
    await parent.locator('.server_site_canvas').click()
    await expect.poll(() => api.messages.some(message => message.t === 'window_input' && message.id === 4)).toBe(true)
    expect(api.messages.filter(message => message.t === 'site_open')).toHaveLength(1)
    await page.screenshot({ path: '.cache/desk-browser-results/server-site-split-devtools.png' })
})


test("a file-less site split keeps its live DevTools host with a stale plugin catalog", async ({ page }) => {
    const api = await owner(page, true), panel = await sessions(page)
    await panel.locator('[data-session-uri="server:window:1"]').click()
    const parent = page.locator('.desk_wbox').last()
    await expect(parent.locator('.server_site_canvas')).toBeVisible()
    await parent.locator('.desk_wbox_head_split').click()
    const child = page.locator('.desk_wbox').last()
    await child.locator('[data-mode="edit"]').click()
    await expect(child).toHaveAttribute('data-plugin', 'auto_site')
    await expect(child.locator('.server_site_canvas')).toBeVisible()
    await expect(child).not.toContainText('No editor for')
    expect(api.messages.some(message => message.t === 'window_devtools' && message.id === 1 && message.open)).toBe(true)
    expect(api.messages.filter(message => message.t === 'site_open')).toHaveLength(0)
})

test("touch clicks use the same native input channel as mouse clicks", async ({ browser }) => {
    const context = await browser.newContext({ baseURL: 'http://127.0.0.1:8124', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    try {
        const page = await context.newPage(), api = await owner(page), panel = await sessions(page)
        await panel.locator('[data-session-uri="server:window:1"]').click()
        await page.locator('#head_menu > summary').click()
        const canvas = page.locator('.desk_wbox').last().locator('.server_site_canvas')
        await expect(canvas).toBeVisible()
        const box = (await canvas.boundingBox())!
        await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
        await expect.poll(() => api.messages.filter(message => message.t === 'window_input' && message.id === 1 && message.input.kind === 'mouse').map(message => message.input.action).slice(-3)).toEqual(['move', 'down', 'up'])
    } finally { await context.close() }
})


test("a script waiting to restart can be stopped from Sessions and its log view", async ({ page }) => {
    const api = await owner(page), panel = await sessions(page)
    await panel.locator('[data-session-uri="file:///run.auto.js"]').click()
    const pane = page.locator('.desk_wbox').last()
    await expect(pane.locator('.server_script_state')).toHaveText('Running')
    api.send({ t: "auto_status", path: "/run.auto.js", running: false, autostart: true, restarting: true })
    await expect(pane.locator('.server_script_state')).toHaveText('Restarting')
    await expect(pane.locator('.server_script_toggle')).toHaveText('Stop')
    await pane.locator('.server_script_toggle').click()
    await expect(pane.locator('.server_script_state')).toHaveText('Stopped')
    api.send({ t: "auto_status", path: "/run.auto.js", running: false, autostart: true, restarting: true })
    const session = panel.locator('.server_session_script')
    await expect(session.locator('[data-session-action="stop"]')).toHaveCount(1)
    await session.locator('[data-session-action="stop"]').click()
    expect(api.messages.filter(message => message.t === 'auto_stop')).toHaveLength(2)
    await expect(session.locator('[data-session-action="start"]')).toHaveCount(1)
    await expect(session.getByRole('button', { name: 'New Window', exact: true })).toHaveCount(1)
})


test("server terminals relay raw PTY bytes without loading the WASM registry or commands", async ({ page }) => {
    const wasm: string[] = []
    await page.route('**/assets/wasm/**', route => { wasm.push(route.request().url()); return route.abort() })
    const api = await owner(page)
    // A late bridge timeout used to overwrite the server preference with pid:.
    await page.waitForTimeout(3000)
    const pane = page.locator('.desk_wbox').first(), address = pane.locator('.desk_wbox_head_path')
    for (const uri of ['pid:', 'server:sh', 'host:', 'pid://sh']) {
        await address.fill(uri); await address.press('Enter')
        await expect(pane.locator('.xterm-rows')).toContainText('jason@jasouza:/home/jason$')
    }
    const input = pane.locator('.xterm-helper-textarea')
    await input.pressSequentially('fastfetch'); await input.press('Enter')
    await expect(pane.locator('.xterm-rows')).toContainText('Pi stdout')
    await expect(pane.locator('.xterm-rows')).toContainText('Pi stderr')
    await expect(pane.locator('.xterm-rows')).toContainText('fastfetch: command not found')
    const bytes = () => api.messages.filter(message => message.t === 'pty_input').map(message => Buffer.from(message.data, 'base64').toString()).join('')
    await expect.poll(bytes).toContain('fastfetch\r')
    await input.press('Control+c')
    await expect.poll(bytes).toContain('\x03')
    api.send({ t: 'status', online: false })
    await expect(pane.locator('.xterm-rows')).toContainText('The server is offline')
    await expect(pane.locator('.xterm-rows')).toContainText('[process exited 1]')
    expect(wasm).toEqual([])
    await expect(pane.locator('.xterm-rows')).not.toContainText('user@jasouza')
})

test("an offline server terminal reports unavailable instead of falling back to WASM", async ({ page }) => {
    const wasm: string[] = []
    await page.route('**/assets/wasm/**', route => { wasm.push(route.request().url()); return route.abort() })
    await page.route('**/api/_/server', route => route.fulfill({ json: { online: false, owner: false, stale: true, snapshot: null } }))
    await page.goto('/server')
    const pane = page.locator('.desk_wbox').first(), address = pane.locator('.desk_wbox_head_path')
    await address.fill('pid:'); await address.press('Enter')
    await expect(pane.locator('.xterm-rows')).toContainText('The server is offline.')
    expect(wasm).toEqual([])
    await expect(pane.locator('.xterm-rows')).not.toContainText('user@jasouza')
})
