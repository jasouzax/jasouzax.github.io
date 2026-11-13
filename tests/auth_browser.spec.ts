/* Real browser/Worker/D1 session UI. Verified callback cryptography is covered independently in auth.test.ts. */
import { test, expect } from "@playwright/test"
import { execFileSync } from "node:child_process"
import { createHash, randomBytes } from "node:crypto"

test("Google session opens admin rooms, links the invited client, survives reload and signs out", async ({ browser, page }) => {
    const admin_token = randomBytes(32).toString("base64url")
    const client_token = randomBytes(32).toString("base64url")
    const email = `google-${Date.now()}@example.com`
    const hash = (token: string) => createHash("sha256").update(token).digest("hex")
    const now = Date.now()
    const subject = `browser-client-${now}`
    const sql = `INSERT OR IGNORE INTO auth_users VALUES ('browser-admin', 'jason@jasouza.com', 'Jason', ${now}); INSERT OR IGNORE INTO auth_owner VALUES (1, 'browser-admin'); INSERT INTO auth_users VALUES ('${subject}', '${email}', 'Client', ${now}); INSERT INTO auth_sessions VALUES ('${hash(admin_token)}','browser-admin',${now},${now}); INSERT INTO auth_sessions VALUES ('${hash(client_token)}','${subject}',${now},${now});`
    execFileSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "d1", "execute", "DB", "--local", "--config", "wrangler.local.jsonc", "--persist-to", ".cache/work-browser-state", "--command", sql], { windowsHide: true, stdio: "pipe" })
    await page.context().addCookies([{ name: "__Host-jazu_session", value: admin_token, url: "https://localhost:8787/", secure: true, httpOnly: true, sameSite: "Lax" }])
    await page.goto("/work")
    await expect(page.getByLabel("Client email", { exact: true })).toBeVisible()
    await expect(page.locator('.desk_messages button[data-sign="out"]')).toHaveText("Sign out of Google")
    await expect(page.locator('.desk_messages button[data-sign="delete"]')).toHaveText("Delete Account")
    await expect(page.locator('#head_account [data-auth="guest"]')).toBeHidden()
    await expect(page.locator('#head_account [data-auth="user"][hidden]')).toHaveCount(0)
    await expect(page.locator("#main-content")).not.toHaveAttribute("inert", "", { timeout: 30000 })
    await page.getByLabel("Client email", { exact: true }).fill(email)
    await page.getByRole("button", { name: "Create conversation", exact: true }).click()
    await expect(page.locator(".desk_messages_toolbar strong")).toHaveText(email)
    await page.getByText("Invitation link", { exact: true }).click()
    const invitation = await page.getByRole("textbox", { name: "Invitation link", exact: true }).inputValue()
    const client_context = await browser.newContext()
    try {
        await client_context.addCookies([{ name: "__Host-jazu_session", value: client_token, url: "https://localhost:8787/", secure: true, httpOnly: true, sameSite: "Lax" }])
        const client = await client_context.newPage()
        await client.goto(invitation)
        await expect(client.getByRole("button", { name: "Link to my Google account", exact: true })).toBeVisible()
        await expect(client.locator("#main-content")).not.toHaveAttribute("inert", "", { timeout: 30000 })
        await client.getByRole("button", { name: "Link to my Google account", exact: true }).click()
        await expect(client.getByRole("button", { name: "Link to my Google account", exact: true })).toHaveCount(0)
        await client.getByRole("textbox", { name: "Write a message…", exact: true }).fill("Hello through my Google session")
        await client.getByRole("button", { name: "Send", exact: true }).click()
        await expect(page.locator(".desk_messages_log")).toContainText("Hello through my Google session", { timeout: 15000 })
        await client.reload()
        await expect(client.locator(".desk_messages_log")).toContainText("Hello through my Google session")
        await expect(client.locator("#main-content")).not.toHaveAttribute("inert", "", { timeout: 30000 })
        await client.getByRole("button", { name: "Sign out of Google", exact: true }).click()
        await expect(client.locator(".desk_messages_composer")).toHaveCount(0)
        await expect(client.getByRole("button", { name: "Sign in with Google", exact: true })).toBeVisible()
        await expect(client.locator('#head_account [data-auth="user"]:not([hidden])')).toHaveCount(0)
        await expect.poll(async () => (await (await client.request.get("http://localhost:8787/api/v1/auth/session")).json()).user).toBeNull()
        await client.goto(invitation)
        await expect(client.locator(".desk_messages")).toContainText("linked invitations require Google sign-in")
        await page.reload()
        await expect(page.getByRole("button", { name: email, exact: true })).toBeVisible()
        await expect(page.locator("#main-content")).not.toHaveAttribute("inert", "", { timeout: 30000 })
        await page.getByRole("button", { name: email, exact: true }).click()
        await expect(page.locator(".desk_messages_log")).toContainText("Hello through my Google session")
    } finally { await client_context.close() }
})

test("Google button requests the code flow with the exact backend callback", async ({ page }) => {
    let authorization = ""
    // Intercept the first request in the redirect chain, before a synthetic client can reach Google.
    await page.route("**/api/v1/auth/google/start", async route => {
        const response = await route.fetch({ maxRedirects: 0 })
        expect(response.status()).toBe(302)
        authorization = response.headers().location
        await route.fulfill({ status: 200, contentType: "text/plain", body: "Mock Google sign-in page; no external request made." })
    })
    await page.goto("/work")
    await expect(page.getByRole("button", { name: "Sign in with Google", exact: true })).toBeVisible()
    await expect(page.locator("#main-content")).not.toHaveAttribute("inert", "", { timeout: 30000 })
    await page.getByRole("button", { name: "Sign in with Google", exact: true }).click()
    await expect.poll(() => authorization).not.toBe("")
    const url = new URL(authorization)
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:8787/api/v1/auth/google/callback")
    expect(url.searchParams.get("response_type")).toBe("code")
    expect(url.searchParams.get("code_challenge_method")).toBe("S256")
    expect(url.searchParams.has("client_secret")).toBe(false)
})


test("signed-in menu replaces sign-in, cancellation preserves the account, confirmed deletion removes it", async ({ page }) => {
    const token = randomBytes(32).toString("base64url")
    const subject = `delete-browser-${Date.now()}`
    const hash = createHash("sha256").update(token).digest("hex")
    const now = Date.now()
    const sql = `INSERT INTO auth_users VALUES ('${subject}', '${subject}@example.com', 'Delete Test', ${now}); INSERT INTO auth_sessions VALUES ('${hash}','${subject}',${now},${now});`
    execFileSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "d1", "execute", "DB", "--local", "--config", "wrangler.local.jsonc", "--persist-to", ".cache/work-browser-state", "--command", sql], { windowsHide: true, stdio: "pipe" })
    await page.context().addCookies([{ name: "__Host-jazu_session", value: token, url: "https://localhost:8787/", secure: true, httpOnly: true, sameSite: "Lax" }])
    await page.goto("/work")
    await expect(page.locator('.desk_messages [data-sign="delete"]')).toBeVisible()
    await expect(page.locator("#main-content")).not.toHaveAttribute("inert", "", { timeout: 30000 })
    await page.locator("#head_account > summary").click()
    const account = page.locator("#head_account")
    await expect(account.getByRole("button", { name: "Sign in with Google", exact: true })).toBeHidden()
    await expect(account.getByRole("button", { name: "Sign out of Google", exact: true })).toBeVisible()
    const remove = account.getByRole("button", { name: "Delete Account", exact: true })
    await expect(remove).toBeVisible()
    page.once("dialog", async dialog => { expect(dialog.message()).toContain("Your Google account is not deleted"); await dialog.dismiss() })
    await remove.click()
    const retained = await (await page.request.get("http://localhost:8787/api/v1/auth/session")).json()
    expect(retained.user.email).toBe(`${subject}@example.com`)
    page.once("dialog", async dialog => { await dialog.accept() })
    await remove.click()
    await expect(page.locator('.desk_messages').getByRole("button", { name: "Sign in with Google", exact: true })).toBeVisible()
    await expect(account.locator('[data-auth="user"]:not([hidden])')).toHaveCount(0)
    const after = await (await page.request.get("http://localhost:8787/api/v1/auth/session")).json()
    expect(after.user).toBeNull()
    await page.reload()
    await expect(page.locator('.desk_messages [data-sign="delete"]')).toHaveCount(0)
})
