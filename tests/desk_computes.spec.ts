import { test, expect } from "./desk_fixture.ts"

test("Files options remain visible and Computes switch independent roots with a peer network", async ({ page }) => {
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message))
    await page.goto("/desk")
    await page.locator("#head_menu > summary").click()
    const files = page.locator('[data-options-for="file:///"]')
    await expect(files).toBeVisible()
    await expect(files.locator("button[data-act]")).toHaveCount(9)
    await expect(files.locator('[data-act="rename"]')).toBeDisabled()
    await expect(files.locator(".desk_option_caption")).toHaveText(["Clip", "New", "Disk", /\s*/])
    await page.locator('.desk_side_tabs_drop[data-path="desk:computes"] > summary').click()
    await expect(page.locator(".desk_side_mode")).toBeVisible()
    await expect(page.locator(".desk_side_mode")).toBeDisabled()
    const options = page.locator('[data-options-for="desk:computes"]')
    await expect(options.getByRole("button", { name: "Delete", exact: true })).toBeDisabled()
    page.once("dialog", dialog => dialog.accept("Lab"))
    await options.getByRole("button", { name: "Compute", exact: true }).click()
    await expect(page.locator('[data-compute-id]')).toHaveCount(2)
    await expect(page.locator(".desk")).not.toHaveAttribute("data-compute", "vfs")
    await page.locator('.desk_side_tabs_drop[data-path="file:///"] > summary').click()
    await files.locator('[data-act="new_file"]').click()
    const draft = page.locator(".desk_side_item_rename"); await draft.fill("lab.txt"); await draft.press("Enter")
    await expect(page.locator('.desk_side_item[data-path="/home/user/lab.txt"]')).toHaveCount(1)
    await page.locator('.desk_side_tabs_drop[data-path="desk:computes"] > summary').click()
    await page.locator('[data-compute-id="vfs"] > details > summary').click()
    await page.locator('.desk_side_tabs_drop[data-path="file:///"] > summary').click()
    await expect(page.locator('.desk_side_item[data-path="/home/user/lab.txt"]')).toHaveCount(0)
    await expect(page.locator('.desk_side_item[data-path="/net"]')).toHaveCount(1)
    const peer = page.locator('[data-compute-id]').last()
    const id = await peer.getAttribute("data-compute-id")
    const path = page.locator(".desk_wbox_head_path").first()
    await page.locator("#head_menu > summary").click()
    await path.fill(`file:///net/${id}/home/user/lab.txt`); await path.press("Enter")
    await expect(page.locator("textarea.desk_wbox_body_text_input").first()).toHaveValue("")
    await page.locator("#head_menu > summary").click()
    await page.screenshot({ path: ".cache/desk-browser-results/computes-network.png" })
    expect(errors).toEqual([])
})

test("popup login refreshes the original page without replacing its draft or URL", async ({ page, context }) => {
    let signed = false
    await context.route("**/api/_/session*", route => route.fulfill({ json: { user: signed ? { email: "test@example.com", name: "Test", role: "client", picture: "https://lh3.googleusercontent.com/test" } : null, csrf: "csrf", google_enabled: true } }))
    await context.route("**/api/_/auth/google/start", async route => {
        await route.fulfill({ contentType: "text/html", body: '<script>location="https://accounts.google.com/jazu-popup-test"</script>' })
    })
    await context.route("https://accounts.google.com/jazu-popup-test", route => route.fulfill({ contentType: "text/html", headers: { "cross-origin-opener-policy": "same-origin" }, body: '<script>location="http://127.0.0.1:8124/api/_/auth/google/callback"</script>' }))
    await context.route("**/api/_/auth/google/callback", async route => {
        signed = true
        await route.fulfill({ contentType: "text/html", headers: { "cross-origin-opener-policy": "same-origin-allow-popups" }, body: '<script>new BroadcastChannel("jazu:oauth").postMessage({type:"jazu:oauth"});window.close()</script>' })
    })
    await page.goto("/desk")
    const pane = page.locator(".desk_wbox").first()
    await pane.locator('input[type="file"]').setInputFiles({ name: "draft.txt", mimeType: "text/plain", buffer: Buffer.from("keep this draft") })
    await expect(pane.locator("textarea.desk_wbox_body_text_input")).toHaveValue("keep this draft")
    await page.locator("#head_account > summary").click()
    const popup = context.waitForEvent("page")
    await page.locator('#head_account [data-sign="google"]').click()
    await popup
    await expect(page.locator('#head_account [data-sign="out"]')).toBeVisible()
    await expect(page).toHaveURL(/\/desk$/)
    await expect(pane.locator("textarea.desk_wbox_body_text_input")).toHaveValue("keep this draft")
})

test("Computes and Files are available in a fixed converter desk", async ({ page }) => {
    await page.goto("/desk/png-to-jpeg")
    await expect(page.locator('.desk_side_tabs_drop[data-path="desk:computes"]')).toHaveCount(1)
    await expect(page.locator('.desk_side_tabs_drop[data-path="file:///"]')).toHaveCount(1)
    await expect(page.locator('[data-compute-id="vfs"]')).toHaveCount(1)
})


test("shared filesystem asks for another folder and never replaces the original private home", async ({ page }) => {
    await page.addInitScript(() => {
        let count = 0
        Object.defineProperty(window, "showDirectoryPicker", { value: async () => {
            count++; (window as any).computePickerCount = count
            return (await (navigator as any).storageBuckets.open("compute-folder-" + count)).getDirectory()
        } })
    })
    await page.goto("/desk")
    await page.evaluate(async () => {
        const root = await navigator.storage.getDirectory(), writer = await (await root.getFileHandle("private.txt", { create: true })).createWritable()
        await writer.write("original home"); await writer.close()
    })
    await page.locator("#head_menu > summary").click()
    await page.locator('.desk_side_tabs_drop[data-path="desk:computes"] > summary').click()
    const options = page.locator('[data-options-for="desk:computes"]')
    for (let count = 1; count <= 2; count++) {
        await options.getByRole("button", { name: "Filesystem", exact: true }).click()
        await page.getByRole("dialog", { name: "Connect filesystem" }).getByRole("button", { name: "Connect", exact: true }).click()
        await expect(page.getByRole("dialog", { name: "Connect filesystem" })).not.toBeVisible()
        await expect(page.locator("[data-compute-id]")).toHaveCount(count + 1)
    }
    expect(await page.evaluate(() => (window as any).computePickerCount)).toBe(2)
    expect(await page.evaluate(async () => (await (await (await navigator.storage.getDirectory()).getFileHandle("private.txt")).getFile()).text())).toBe("original home")
})

test("WASM terminals stay on their compute after Files switches to a peer", async ({ page }) => {
    test.setTimeout(120000)
    await page.goto("/desk")
    await page.locator("#head_menu > summary").click()
    await page.locator('.desk_side_tabs_drop[data-path="desk:computes"] > summary').click()
    page.once("dialog", dialog => dialog.accept("WASM lab"))
    await page.locator('[data-options-for="desk:computes"]').getByRole("button", { name: "Compute", exact: true }).click()
    await expect(page.locator("[data-compute-id]")).toHaveCount(2)
    await page.locator("#head_menu > summary").click()
    const pane = page.locator(".desk_wbox").first()
    await pane.getByRole("button", { name: "Open terminal", exact: true }).click()
    const screen = pane.locator(".xterm-rows"), input = pane.locator(".xterm-helper-textarea")
    await expect(screen).toContainText("user@jasouza:", { timeout: 45000 })
    await input.pressSequentially("echo compute-only > /home/user/scoped.txt; cat /home/user/scoped.txt"); await input.press("Enter")
    await expect(screen).toContainText("compute-only")
    await page.locator("#head_menu > summary").click()
    await page.locator('[data-compute-id="vfs"] > details > summary').click()
    await expect(page.locator(".desk")).toHaveAttribute("data-compute", "vfs")
    await page.locator("#head_menu > summary").click()
    await input.pressSequentially("cat /home/user/scoped.txt; echo PINNED_$?"); await input.press("Enter")
    await expect(screen).toContainText("PINNED_0")
    expect(await page.evaluate(async () => { try { await (await navigator.storage.getDirectory()).getFileHandle("scoped.txt"); return true } catch { return false } })).toBe(false)
})
