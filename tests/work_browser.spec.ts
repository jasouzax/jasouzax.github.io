import { test, expect } from "@playwright/test"
const owner_token = "work_browser_test_owner_01234567890123456789"

test("owner and client chat through encrypted D1 with correct im addresses and safe retries", async ({ browser, page }) => {
    const errors: string[] = []
    page.on("pageerror", error => errors.push(error.message))
    await page.goto("/work")
    await expect(page.locator(".desk_messages")).toBeVisible()
    await expect(page.locator("#main-content")).not.toHaveAttribute("inert", "", { timeout: 30000 })
    await page.getByText("Owner access", { exact: true }).click()
    await page.getByLabel("Owner access token", { exact: true }).fill(owner_token)
    await page.getByRole("button", { name: "Connect", exact: true }).click()
    const email = `browser-${Date.now()}@example.com`
    await page.getByLabel("Client email", { exact: true }).fill(email)
    await page.getByRole("button", { name: "Create conversation", exact: true }).click()
    await expect(page.locator(".desk_messages_toolbar strong")).toHaveText(email)
    await expect(page.locator(".desk_wbox_head_path")).toHaveValue(`im:${email}`)
    await expect(page.locator(".desk_wbox_head_mime > summary")).toHaveText("message/cpim")
    await page.getByText("Invitation link", { exact: true }).click()
    const invitation = await page.getByRole("textbox", { name: "Invitation link", exact: true }).inputValue()
    const params = new URL(invitation).hash
    const client_context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const client = await client_context.newPage()
    client.on("pageerror", error => errors.push(error.message))
    try {
        await client.goto(invitation)
        await expect(client.locator(".desk_messages_toolbar strong")).toHaveText("jason@jasouza.com")
        await expect(client.locator("#main-content")).not.toHaveAttribute("inert", "", { timeout: 30000 })
        await expect(client.locator(".desk_wbox_head_path")).toHaveValue("im:jason@jasouza.com")
        await expect(client).toHaveURL(/\/work$/)
        const plain = "Hello Jason 👋 <script>window.compromised=true</script>"
        await client.getByRole("textbox", { name: "Write a message…", exact: true }).fill(plain)
        await expect(client.getByRole("textbox", { name: "Write a message…", exact: true })).toHaveValue(plain)
        const sent = client.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith("/messages"), { timeout: 10000 })
        await client.getByRole("button", { name: "Send", exact: true }).click()
        const acknowledged = await sent
        expect(acknowledged.status(), await acknowledged.text()).toBe(201)
        await expect(client.locator(".desk_messages_log .desk_message")).toHaveCount(1, { timeout: 15000 })
        await expect(page.locator(".desk_messages_log")).toContainText(plain, { timeout: 15000 })
        const fragment = new URLSearchParams(params.slice(1))
        const response = await client.request.get(new URL(`/api/v1/work/rooms/${fragment.get("room")}/messages`, invitation).href, { headers: { authorization: `Bearer ${fragment.get("token")}` } })
        const stored = await response.text()
        expect(stored).not.toContain("Hello Jason")
        expect(stored).not.toContain(fragment.get("key")!)
        expect(await client.evaluate(() => (window as any).compromised)).toBeUndefined()
        let dropped_ack = false
        await page.route("**/api/v1/work/rooms/*/messages", async route => {
            if (route.request().method() === "POST" && !dropped_ack) { dropped_ack = true; await route.fetch(); await route.abort("failed"); return }
            await route.continue()
        })
        await page.getByRole("textbox", { name: "Write a message…", exact: true }).fill("Reply from the owner")
        await page.getByRole("button", { name: "Send", exact: true }).click()
        await expect(page.getByRole("button", { name: "Retry send", exact: true })).toBeEnabled()
        await page.getByRole("button", { name: "Retry send", exact: true }).click()
        await expect(client.locator(".desk_messages_log .desk_message")).toHaveCount(2, { timeout: 15000 })
        await expect(client.locator(".desk_messages_log")).toContainText("Reply from the owner")
        await client.reload()
        await expect(client.locator(".desk_messages_log .desk_message")).toHaveCount(2)
        await expect(client.locator("#main-content")).not.toHaveAttribute("inert", "", { timeout: 30000 })
        await expect(client.locator(".desk_messages")).toBeVisible()
        expect(await client.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await client.screenshot({ path: ".cache/work-client-mobile.png", fullPage: true })
        await page.screenshot({ path: ".cache/work-owner-desktop.png", fullPage: true })
        await page.reload()
        await expect(page.getByText("Owner access", { exact: true })).toBeVisible()
        await expect(page.locator(".desk_messages_composer")).toHaveCount(0)
        expect(errors).toEqual([])
    } catch (error) {
        console.log("Client window:", await client.evaluate(() => document.querySelector(".desk_messages")?.textContent ?? document.body.innerText))
        console.log("Browser errors:", errors)
        await client.screenshot({ path: ".cache/work-client-failure.png", fullPage: true })
        throw error
    } finally { await client_context.close() }
})
