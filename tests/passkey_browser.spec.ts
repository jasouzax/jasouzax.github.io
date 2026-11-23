/* Chromium's virtual CTAP2 authenticator exercises actual WebAuthn signatures against local workerd/D1. */
import { test, expect, type Page } from "@playwright/test"
import { account, reset, sql } from "./work_browser_helpers.ts"

async function api(page: Page, path: string, body?: unknown) {
    return page.evaluate(async ({ path, body }) => {
        const auth = await (await fetch("/api/_/session?fresh=1")).json()
        const response = await fetch(path, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", "x-jazu-work": "1", "x-jazu-csrf": auth.csrf, "x-jazu-confirm-delete": "account" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
        return { status: response.status, data: await response.json() }
    }, { path, body })
}
test.beforeEach(() => reset())
test("passkeys enroll, block new owner sessions, verify signatures once and protect deletion", async ({ page, context }) => {
    const cdp = await context.newCDPSession(page)
    await cdp.send("WebAuthn.enable")
    await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } })
    await account(context, "passkeys-owner@example.com", true)
    await page.goto("/desk")
    await expect(page.locator("#main-content")).not.toHaveAttribute("inert", "")
    await page.locator("#head_account > summary").click()
    await page.getByRole("button", { name: "Passkeys", exact: true }).click()
    const settings = page.getByRole("dialog", { name: "Passkeys", exact: true })
    await settings.getByRole("button", { name: "Add passkey", exact: true }).click()
    await expect(settings.getByRole("status")).toHaveText("Passkey added")
    let status = await api(page, "/api/_/auth/passkeys")
    expect(status.data.keys).toHaveLength(1)
    expect(JSON.stringify(status.data)).not.toContain("public_key")
    await settings.getByRole("button", { name: "Close", exact: true }).click()

    // A fresh OAuth session alone must not recover owner powers once a passkey is configured.
    await account(context, "passkeys-owner@example.com", true)
    await page.reload()
    const locked = await api(page, "/api/_/session?fresh=1")
    expect(locked.data.user.role).toBe("client")
    expect(locked.data.user.step_up).toBe(true)
    expect((await api(page, "/api/_/auth/account/delete", {})).status).toBe(403)
    const options = await api(page, "/api/_/auth/passkeys/verify/options", {})
    expect(options.data.userVerification).toBe("required")
    const credential = await page.evaluate(async options => {
        const publicKey = (PublicKeyCredential as any).parseRequestOptionsFromJSON(options)
        return (await navigator.credentials.get({ publicKey }) as any).toJSON()
    }, options.data)
    expect((await api(page, "/api/_/auth/passkeys/verify", { credential })).status).toBe(200)
    expect((await api(page, "/api/_/auth/passkeys/verify", { credential })).status).toBe(400)
    expect((await api(page, "/api/_/session?fresh=1")).data.user.role).toBe("owner")

    // Stale proof cannot delete, and failed signature verification consumes its own challenge.
    sql("UPDATE auth_stepups SET verified_at = 1")
    expect((await api(page, "/api/_/auth/account/delete", {})).status).toBe(403)
    await api(page, "/api/_/auth/passkeys/verify/options", {})
    expect((await api(page, "/api/_/auth/passkeys/verify", { credential })).status).toBe(400)
    expect((await api(page, "/api/_/auth/account/delete", {})).status).toBe(403)

    await page.locator("#head_account > summary").click()
    await page.getByRole("button", { name: "Passkeys", exact: true }).click()
    await settings.getByRole("button", { name: "Verify passkey", exact: true }).click()
    await expect(settings.getByRole("status")).toHaveText("Passkey verified")
    await settings.getByRole("button", { name: "Close", exact: true }).click()
    expect((await api(page, "/api/_/auth/account/delete", {})).status).toBe(200)
    expect((await api(page, "/api/_/session?fresh=1")).data.user).toBeNull()
})

test("stale sessions without passkeys require a fresh Google sign-in and cannot silently delete", async ({ page, context }) => {
    await account(context, "stale-no-passkey@example.com")
    sql("UPDATE auth_sessions SET created_at = 1")
    await page.goto("/desk")
    expect((await api(page, "/api/_/auth/account/delete", {})).status).toBe(403)
    expect((await api(page, "/api/_/auth/passkeys/register/options", {})).status).toBe(403)
    await account(context, "stale-no-passkey@example.com")
    expect((await api(page, "/api/_/auth/account/delete", {})).status).toBe(200)
})
