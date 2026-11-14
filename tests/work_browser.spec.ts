import { test, expect, type Page } from "@playwright/test"
import { account, reset, drive_files, denied_drive, failed_uploads, sql } from "./work_browser_helpers.ts"
test.beforeEach(() => reset())
const writer = (page: Page) => page.getByRole("textbox", { name: "Write a message…", exact: true })
async function ready(page: Page): Promise<void> { await expect(page.locator("#main-content")).not.toHaveAttribute("inert", "", { timeout: 30000 }) }
async function send(page: Page, message: string): Promise<void> {
    await ready(page); await writer(page).fill(message)
    await page.getByRole("button", { name: "Send", exact: true }).click()
    await expect(page.locator(".desk_messages_log")).toContainText(message, { timeout: 20000 })
}
async function owner(page: Page): Promise<void> {
    await account(page.context(), "jason@jasouza.com", true)
    await page.goto("/work"); await ready(page)
    await expect(page.getByText("Choose a client or guest from the Clients panel to open their conversation.", { exact: true })).toBeVisible({ timeout: 20000 })
    await expect(page.locator('[data-path="im:clients"] summary').first()).toHaveText("Clients")
}

test("a signed-out visitor gets a composer with no invitation or token, and callback errors survive refresh", async ({ page }) => {
    await page.goto("/work?auth_error=token_exchange")
    await expect(writer(page)).toBeVisible()
    await ready(page)
    await writer(page).fill("Draft before owner setup")
    await page.evaluate(() => document.dispatchEvent(new CustomEvent("jazu:auth")))
    await expect(writer(page)).toHaveValue("Draft before owner setup")
    await expect(page.locator('.desk_messages [role="alert"]')).toContainText("token_exchange")
    await expect(page.getByText("Invitation link", { exact: true })).toHaveCount(0)
    await expect(page.getByText("Owner access", { exact: true })).toHaveCount(0)
    await expect(page.locator("[data-work-clients]")).toHaveCount(0)
    await page.getByRole("button", { name: "Send", exact: true }).click()
    await expect(page.locator(".desk_messages_status")).toContainText("owner is setting up")
    await expect(writer(page)).toHaveValue("Draft before owner setup")
    await page.reload()
    await expect(page.locator('.desk_messages [role="alert"]')).toContainText("token_exchange")
})

test("only message history displays a scrollbar in both themes and viewport sizes", async ({ page }) => {
    await page.goto("/work"); await ready(page)
    await expect(writer(page)).toBeVisible()
    for (const theme of ["default", "memory"]) {
        await page.locator(`#theme_name_${theme}`).evaluate((input: HTMLInputElement) => { input.checked = true; input.dispatchEvent(new Event("change", { bubbles: true })) })
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme); await ready(page)
        for (const viewport of [{ width: 1100, height: 790 }, { width: 390, height: 844 }]) {
            await page.setViewportSize(viewport)
            await writer(page).fill(Array.from({ length: 20 }, (_, i) => `Draft line ${i}`).join("\n"))
            await writer(page).press("End")
            const layout = await page.locator(".desk_messages").evaluate(root => {
                const log = root.querySelector<HTMLElement>(".desk_messages_log")!
                log.replaceChildren(...Array.from({ length: 30 }, () => { const row = document.createElement("li"); row.className = "desk_message"; row.textContent = "History message"; return row }))
                const window = root.closest<HTMLElement>(".desk_wbox")!, input = root.querySelector<HTMLTextAreaElement>("textarea")!, composer = root.querySelector<HTMLElement>("form")!
                log.scrollTop = 100
                return { outerOverflow: getComputedStyle(window).overflowY, inputOverflow: getComputedStyle(input).overflowY, inputScrollbar: getComputedStyle(input).scrollbarWidth, logOverflow: getComputedStyle(log).overflowY, logScrolls: log.scrollTop > 0, composerFits: composer.getBoundingClientRect().bottom <= window.getBoundingClientRect().bottom + 1 }
            })
            expect(layout).toEqual({ outerOverflow: "hidden", inputOverflow: "hidden", inputScrollbar: "none", logOverflow: "auto", logScrolls: true, composerFits: true })
            await expect(writer(page)).toHaveValue(/Draft line 19$/)
        }
    }
})

test("guest and owner exchange encrypted messages, recover after reload and safely retry a lost acknowledgement", async ({ page, browser }) => {
    let dropped = false, send_request = ""
    await page.routeWebSocket("**/api/v1/realtime", socket => {
        const server = socket.connectToServer()
        socket.onMessage(message => { try { const frame = JSON.parse(String(message)); if (frame.type === "send" && !dropped) send_request = frame.request_id } catch {}; server.send(message) })
        server.onMessage(message => {
            try { const frame = JSON.parse(String(message)); if (!dropped && send_request && frame.type === "ack" && frame.request_id === send_request) { dropped = true; socket.close({ code: 1011, reason: "Synthetic lost acknowledgement" }); server.close(); return } } catch {}
            socket.send(message)
        })
    })
    await owner(page)
    expect([...drive_files.get("jason@jasouza.com")!.values()][0].owner.private_jwk.d).toBeTruthy()
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const guest = await context.newPage()
    try {
        await guest.goto("http://localhost:8787/work")
        const message = "Guest hello 👋 <script>window.compromised=true</script>"
        await send(guest, message)
        const key = await guest.evaluate(() => JSON.parse(localStorage.getItem("jazu_work_guest_v2")!))
        const info = await guest.evaluate(async () => (await fetch("/api/v1/work/session", { method: "POST", headers: { "x-jazu-work": "1" } })).json())
        const address = `guest/${info.guest_room.guest_id}`
        await expect(guest.locator(".desk_wbox_head_path")).toHaveValue("im:jason@jasouza.com")
        await page.locator("[data-work-guests] > summary").click()
        const entry = page.getByRole("button", { name: address, exact: true })
        await expect(entry).toBeVisible({ timeout: 25000 }); await entry.click()
        const chat = page.locator(".desk_messages").filter({ has: page.locator(".desk_messages_toolbar strong", { hasText: address }) })
        await expect(chat.locator(".desk_messages_log")).toContainText(message)
        await expect(page.locator("[data-work-clients] ul, [data-work-clients] li")).toHaveCount(0)
        await expect(page.locator("[data-work-clients] .desk_client_entity")).toHaveCount(1)
        await expect(page.locator(`.desk_wbox_head_path`).last()).toHaveValue(`im:${address}`)
        await chat.getByRole("textbox", { name: "Write a message…" }).fill("Reply from Jason")
        await chat.getByRole("button", { name: "Send", exact: true }).click()
        await expect(chat.getByRole("button", { name: "Retry send", exact: true })).toBeEnabled()
        await chat.getByRole("button", { name: "Retry send", exact: true }).click()
        await expect(guest.locator(".desk_messages_log .desk_message")).toHaveCount(2, { timeout: 15000 })
        await expect(chat.locator(".desk_message_meta time")).toHaveCount(2)
        await expect(chat.locator(".desk_message_body time")).toHaveCount(0)
        await expect(chat.locator(".desk_messages_account img")).toBeVisible()
        await expect(chat.locator(".desk_messages_identity")).toHaveText("Signed in with Google")
        await guest.reload()
        await ready(guest)
        await expect(guest.locator(".desk_messages_log")).toContainText("Reply from Jason")
        expect(await guest.evaluate(() => JSON.parse(localStorage.getItem("jazu_work_guest_v2")!).key)).toBe(key.key)
        expect(await guest.evaluate(() => (window as any).compromised)).toBeUndefined()
        expect(await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        const stored = await guest.evaluate(async id => (await fetch(`/api/v1/work/rooms/${id}/messages`)).text(), key.room)
        expect(stored).not.toContain("Guest hello"); expect(stored).not.toContain(key.key)
        await guest.screenshot({ path: ".cache/work-guest-mobile.png", fullPage: true })
        await page.screenshot({ path: ".cache/work-clients-desktop.png", fullPage: true })
        await page.locator("#theme_name_memory").evaluate((input: HTMLInputElement) => { input.checked = true; input.dispatchEvent(new Event("change", { bubbles: true })) })
        await expect(page.locator("html")).toHaveAttribute("data-theme", "memory")
        await ready(page)
        await expect(chat.getByRole("textbox", { name: "Write a message…" })).toBeVisible()
        await page.screenshot({ path: ".cache/work-clients-memory.png", fullPage: true })
        const stranger = await browser.newContext()
        try {
            const other = await stranger.newPage(); await other.goto("http://localhost:8787/work")
            await expect(other.locator(".desk_messages_connection")).toContainText("Online")
            expect(await other.evaluate(async id => (await fetch(`/api/v1/work/rooms/${id}/messages`)).status, key.room)).toBe(404)
        } finally { await stranger.close() }
    } finally { await context.close() }
})

test("clients without Drive consent retain guest history and recover the encrypted fallback on another device", async ({ page, browser }) => {
    await owner(page)
    const direct = await browser.newContext(), direct_email = "direct-no-drive@example.com"
    try {
        denied_drive.add(direct_email); await account(direct, direct_email)
        const signed_in = await direct.newPage(); await signed_in.goto("/work")
        await send(signed_in, "My first message without Drive or a guest key")
        await expect(signed_in.getByRole("button", { name: "Provide Drive access for E2E encryption", exact: true })).toBeVisible()
        await signed_in.reload(); await ready(signed_in)
        await expect(signed_in.locator(".desk_messages_log")).toContainText("My first message without Drive or a guest key")
    } finally { await direct.close() }
    const context = await browser.newContext(), client = await context.newPage(), email = "no-drive@example.com"
    try {
        await client.goto("/work"); await send(client, "Guest before declining Drive")
        const original = await client.evaluate(() => JSON.parse(localStorage.getItem("jazu_work_guest_v2")!))
        denied_drive.add(email); await account(context, email); await client.reload(); await ready(client)
        await expect(client.getByRole("button", { name: "Provide Drive access for E2E encryption", exact: true })).toBeVisible()
        await expect(client.locator(".desk_messages_notice")).toContainText("server-recoverable")
        await expect(client.locator(".desk_messages_log")).toContainText("Guest before declining Drive")
        await send(client, "Signed in without Drive")
        expect(await client.evaluate(() => localStorage.getItem("jazu_work_guest_v2"))).toBeNull()
        expect(drive_files.get(email)!.size).toBe(0)
        const next = await browser.newContext()
        try {
            await account(next, email); const recovered = await next.newPage(); await recovered.goto("/work"); await ready(recovered)
            await expect(recovered.locator(".desk_messages_log")).toContainText("Signed in without Drive")
            const backup = await recovered.evaluate(async () => { const auth = await (await fetch("/api/v1/auth/session")).json(); return (await fetch("/api/v1/work/unstored-key", { method: "POST", headers: { "content-type": "application/json", "x-jazu-work": "1", "x-jazu-csrf": auth.csrf }, body: JSON.stringify({ action: "load" }) })).json() })
            expect(backup.client.key).toBe(original.key)
            // Browser tests mock Google's APIs. The server-side verifier/deletion is exercised separately with real SQL/Web Crypto.
            await next.route("**/api/v1/work/unstored-key", async route => {
                const body = route.request().postDataJSON()
                if (body.action !== "drive") { await route.continue(); return }
                const saved = [...drive_files.get(email)!.values()][0].client
                expect(saved.key).toBe(original.key); expect(saved.room).toBe(original.room)
                sql(`INSERT INTO work_key_promotions SELECT subject, room_id, 'browser-verification' FROM unstored_keys WHERE email = '${email}'; DELETE FROM unstored_keys WHERE email = '${email}';`)
                await route.fulfill({ json: { removed: true } })
            })
            denied_drive.delete(email); await recovered.reload(); await ready(recovered)
            await expect(recovered.locator(".desk_messages_identity")).toHaveText("Signed in with Google")
            await expect(recovered.locator(".desk_messages_log")).toContainText("Signed in without Drive")
            expect([...drive_files.get(email)!.values()][0].client.key).toBe(original.key)
        } finally { await next.close() }
    } finally { await context.close() }
})

test("Drive upload failures use fallback storage and a consent button opens the existing Google consent flow", async ({ page, browser }) => {
    await owner(page)
    const context = await browser.newContext(), client = await context.newPage(), email = "failed-upload@example.com"
    try {
        failed_uploads.add(email); await account(context, email); await client.goto("/work"); await send(client, "Recover after failed upload")
        await expect(client.getByRole("button", { name: "Provide Drive access for E2E encryption", exact: true })).toBeVisible()
        await client.reload(); await ready(client)
        await expect(client.locator(".desk_messages_log")).toContainText("Recover after failed upload")
        await client.route("**/api/v1/auth/google/start?drive=1", route => route.fulfill({ contentType: "text/html", body: "Google Drive consent requested" }))
        await client.getByRole("button", { name: "Provide Drive access for E2E encryption", exact: true }).click()
        await expect(client).toHaveURL(/\/api\/v1\/auth\/google\/start\?drive=1$/)
    } finally { await context.close() }
})

test("first Google sign-in saves the guest key, links history and restores it on another device", async ({ page, browser }) => {
    await owner(page)
    const context = await browser.newContext(), client = await context.newPage()
    const email = "first-client@example.com"
    try {
        await client.goto("http://localhost:8787/work"); await send(client, "Message before Google")
        const guest_key = await client.evaluate(() => JSON.parse(localStorage.getItem("jazu_work_guest_v2")!).key)
        await account(context, email); await client.reload()
        await expect(client.locator(".desk_messages_log")).toContainText("Message before Google")
        expect([...drive_files.get(email)!.values()][0].client.key).toBe(guest_key)
        expect(await client.evaluate(() => localStorage.getItem("jazu_work_guest_v2"))).toBeNull()
        await expect(page.getByRole("button", { name: email, exact: true })).toBeVisible({ timeout: 25000 })
        await page.getByRole("button", { name: email, exact: true }).click()
        await expect(page.locator("[data-work-clients] .desk_client_entity img")).toBeVisible()
        await expect(page.locator(".desk_wbox_head_path").last()).toHaveValue(`im:${email}`)
        const device = await browser.newContext()
        try {
            await account(device, email)
            const restored = await device.newPage(); await restored.goto("http://localhost:8787/work")
            await expect(restored.locator(".desk_messages_log")).toContainText("Message before Google")
            expect(await restored.evaluate(() => localStorage.getItem("jazu_work_guest_v2"))).toBeNull()
            await send(restored, "Another device")
            await expect(client.locator(".desk_messages_log")).toContainText("Another device", { timeout: 15000 })
        } finally { await device.close() }
        await client.locator('.desk_messages_account > summary').click()
        await client.locator('.desk_messages [data-sign="out"]').click()
        await expect(client.locator('.desk_messages_toolbar [data-sign="google"]')).toBeVisible()
        await send(client, "New guest after linking and signing out")
        await expect(client.locator(".desk_messages_log")).not.toContainText("Message before Google")
    } finally { await context.close() }
})

test("a signed-in owner receives notifications outside Work and sees live disconnect/reconnect without message polling", async ({ page, browser }) => {
    await page.addInitScript(() => {
        ;(window as any).notification_requests = 0
        Object.defineProperty(window, "Notification", { configurable: true, value: class {
            static permission = "default"
            static async requestPermission() { (window as any).notification_requests++; this.permission = "granted"; return "granted" }
            onclick: (() => void) | null = null
            close() {}
        } })
    })
    await owner(page); await page.goto("/"); await ready(page)
    await page.locator("#head_account > summary").click()
    const enable = page.getByRole("button", { name: "Enable message notifications", exact: true })
    await expect(enable).toBeVisible(); expect(await page.evaluate(() => (window as any).notification_requests)).toBe(0)
    await enable.click(); await expect(page.getByRole("button", { name: "Notifications enabled", exact: true })).toBeVisible()
    await page.locator("#head_account > summary").click()
    const context = await browser.newContext()
    try {
        let guest = await context.newPage(); await guest.goto("/work"); await send(guest, "A message while you browse the portfolio")
        await expect(guest.locator(".desk_messages_connection")).toHaveText("Online")
        const notice = page.locator(".realtime_notification a")
        await expect(notice).toContainText("New encrypted message")
        await page.screenshot({ path: ".cache/realtime-notification.png", fullPage: true })
        await notice.click(); await ready(page)
        await expect(page.locator(".desk_messages_log")).toContainText("A message while you browse the portfolio")
        await expect(page.locator(".desk_messages_connection")).toHaveText("Online")
        let reads = 0
        page.on("request", request => { if (request.method() === "GET" && /\/rooms\/[^/]+\/messages/.test(request.url())) reads++ })
        await page.waitForTimeout(1000); const baseline = reads
        await page.waitForTimeout(6500); expect(reads).toBe(baseline)
        await guest.close()
        await expect(page.locator(".desk_messages_connection")).toContainText("Last online", { timeout: 15000 })
        guest = await context.newPage(); await guest.goto("/work"); await ready(guest)
        await expect(page.locator(".desk_messages_connection")).toHaveText("Online", { timeout: 15000 })
        await send(guest, "Back online")
        await expect(page.locator(".desk_messages_log")).toContainText("Back online")
    } finally { await context.close() }
})

test("client deletion immediately refreshes the owner's entity and closes the open composer", async ({ page, browser }) => {
    await owner(page)
    const context = await browser.newContext(), email = "deleted-client@example.com"
    try {
        await account(context, email); const client = await context.newPage(); await client.goto("/work"); await send(client, "Shared history stays encrypted")
        await expect(page.getByRole("button", { name: email, exact: true })).toBeVisible({ timeout: 15000 })
        await page.getByRole("button", { name: email, exact: true }).click()
        const chat = page.locator(".desk_messages").last()
        await expect(chat.locator(".desk_messages_log")).toContainText("Shared history stays encrypted")
        await client.locator(".desk_messages_account > summary").click()
        client.once("dialog", async dialog => { await dialog.accept() })
        await client.locator('.desk_messages [data-sign="delete"]').click()
        await expect(chat.getByRole("textbox", { name: "Write a message…" })).toBeDisabled({ timeout: 15000 })
        await expect(chat.locator(".desk_messages_notice")).toContainText("closed")
        await expect(page.getByRole("button", { name: email, exact: true })).toHaveCount(0)
        await expect(chat.locator(".desk_messages_log")).toContainText("Shared history stays encrypted")
    } finally { await context.close() }
})

test("guest tabs replace the active socket and recover the same conversation when focused", async ({ page, browser }) => {
    await owner(page)
    const context = await browser.newContext()
    try {
        const first = await context.newPage(), second = await context.newPage()
        await first.goto("http://localhost:8787/work"); await send(first, "First tab")
        await second.goto("http://localhost:8787/work"); await send(second, "Second tab")
        await expect(first.locator(".desk_messages_connection")).toHaveText("Connected in another tab")
        await first.bringToFront(); await first.evaluate(() => window.dispatchEvent(new Event("focus")))
        await expect(first.locator(".desk_messages_log")).toContainText("Second tab", { timeout: 15000 })
        await expect(second.locator(".desk_messages_log")).toContainText("First tab", { timeout: 15000 })
        const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("jazu_work_guest_v2")!))
        expect(await saved(first)).toEqual(await saved(second))
        await expect(first.locator(".desk_messages_log .desk_message")).toHaveCount(2)
    } finally { await context.close() }
})

test("an existing Google key warns without transferring or overwriting a later guest conversation", async ({ page, browser }) => {
    await owner(page)
    const context = await browser.newContext(), client = await context.newPage()
    const email = "returning-client@example.com"
    try {
        await account(context, email); await client.goto("http://localhost:8787/work"); await send(client, "Account history")
        const saved = JSON.stringify([...drive_files.get(email)!.values()][0])
        await writer(client).fill("Unsent account draft")
        await client.locator('.desk_messages_account > summary').click()
        await client.locator('.desk_messages [data-sign="out"]').click()
        await expect(client.locator('.desk_messages_toolbar [data-sign="google"]')).toBeVisible()
        await expect(writer(client)).toHaveValue("")
        await send(client, "Separate anonymous history")
        const guest_key = await client.evaluate(() => JSON.parse(localStorage.getItem("jazu_work_guest_v2")!))
        await account(context, email); await client.reload()
        await expect(client.locator('.desk_messages [role="alert"]')).toContainText("Guest messages were not transferred")
        await expect(client.locator(".desk_messages_log")).toContainText("Account history")
        await expect(client.locator(".desk_messages_log")).not.toContainText("Separate anonymous history")
        expect(JSON.stringify([...drive_files.get(email)!.values()][0])).toBe(saved)
        expect(await client.evaluate(() => JSON.parse(localStorage.getItem("jazu_work_guest_v2")!).key)).toBe(guest_key.key)
        await client.locator('.desk_messages_account > summary').click()
        await client.locator('.desk_messages [data-sign="out"]').click()
        await expect(client.locator(".desk_messages_log")).toContainText("Separate anonymous history")
    } finally { await context.close() }
})
