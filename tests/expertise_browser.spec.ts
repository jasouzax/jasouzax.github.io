import { test, expect } from "@playwright/test"

for (const width of [1440, 390]) {
    test(`slide skill tabs switch versions and restore history at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 1000 })
        await page.goto("/#web-app/gdsc")
        await expect(page.locator("html")).not.toHaveAttribute("data-skeleton", /.+/, { timeout: 12000 })
        const web = page.locator('.slide:has([id="web-app/gdsc"])')
        const cloud = page.locator('.slide:has([id="cloud/gdsc"])')
        await expect(web).toBeVisible()
        await expect(cloud).toBeHidden()
        await expect(web.locator(".slide_desc")).toContainText("Vuetify")
        const active = web.locator('[data-skill="web-app"]')
        await expect(active).toHaveAttribute("aria-current", "true")
        await expect(active).toHaveCSS("background-image", "none")
        await expect(web.locator('[data-skill="cloud"]')).toHaveCSS("background-image", /linear-gradient/)
        await web.locator('[data-skill="cloud"]').click()
        await expect(page).toHaveURL(/#cloud\/gdsc$/)
        await expect(cloud).toBeVisible()
        await expect(web).toBeHidden()
        await expect(cloud.locator(".slide_desc")).toContainText("Firestore")
        await expect(cloud.locator('[data-skill="cloud"]')).toHaveAttribute("aria-current", "true")
        await expect(cloud.locator('[data-skill="cloud"]')).toHaveCSS("background-image", "none")
        // Read both boxes in one frame while the fragment's smooth scroll is running.
        const [card, tabs] = await cloud.evaluate(slide => [".slide_card", ".slide_skills"].map(selector =>
            slide.querySelector(selector)!.getBoundingClientRect().toJSON()))
        expect(Math.abs(tabs.x - card.x)).toBeLessThan(2)
        expect(Math.abs(tabs.bottom - card.bottom)).toBeLessThan(2)
        await page.screenshot({ path: `.cache/expertise-skills-${width}.png` })
        await page.goBack()
        await expect(web).toBeVisible()
        await expect(cloud).toBeHidden()
    })
}

test("search keeps each project version independently addressable and skill links leave search", async ({ page }) => {
    await page.goto("/?search=GDSC")
    await expect(page.locator("html")).not.toHaveAttribute("data-skeleton", /.+/, { timeout: 12000 })
    const variants = page.locator('.slide.hit[data-search-id^="gdsc--"]')
    await expect(variants).toHaveCount(2)
    const ids = await page.locator('[id^="search/gdsc--"]').evaluateAll(nodes => nodes.map(node => node.id))
    expect(new Set(ids).size).toBe(2)
    const web = page.locator('.slide:has([id="web-app/gdsc"])')
    await web.locator('[data-skill="cloud"]').click()
    await expect(page).toHaveURL(/\/#cloud\/gdsc$/)
    await expect(page.locator(".expertise")).not.toHaveClass(/is_searching/)
    await expect(page.locator('.slide:has([id="cloud/gdsc"])')).toBeVisible()
})

test("Japanese slide versions also switch in the Memory theme", async ({ page }) => {
    await page.goto("/ja/#web-app/gdsc")
    await expect(page.locator("html")).not.toHaveAttribute("data-skeleton", /.+/, { timeout: 12000 })
    await page.locator("#theme_name_memory").evaluate((input: HTMLInputElement) => {
        input.checked = true
        input.dispatchEvent(new Event("change", { bubbles: true }))
    })
    await expect(page.locator("html")).toHaveAttribute("data-theme", "memory")
    await expect(page.locator("html")).not.toHaveAttribute("data-skeleton", /.+/, { timeout: 12000 })
    const web = page.locator('.slide:has([id="web-app/gdsc"])')
    await expect(web.locator('[data-skill="cloud"]')).toHaveCSS("background-image", /linear-gradient/)
    await web.locator('[data-skill="cloud"]').click()
    const cloud = page.locator('.slide:has([id="cloud/gdsc"])')
    await expect(cloud).toBeVisible()
    await expect(web).toBeHidden()
    await expect(cloud.locator(".slide_desc")).toContainText("Firestore")
    await expect(cloud.locator('[data-skill="cloud"]')).toHaveAttribute("aria-current", "true")
    await expect(cloud.locator('[data-skill="cloud"]')).toHaveCSS("background-image", "none")
})

test.describe("without JavaScript", () => {
    test.use({ javaScriptEnabled: false })
    test("skill links select the correct slide and active tab", async ({ page }) => {
        await page.goto("/#web-app/gdsc")
        const web = page.locator('.slide:has([id="web-app/gdsc"])')
        await expect(web).toBeVisible()
        await web.locator('[data-skill="cloud"]').click()
        const cloud = page.locator('.slide:has([id="cloud/gdsc"])')
        await expect(cloud).toBeVisible()
        await expect(web).toBeHidden()
        await expect(cloud.locator('[data-skill="cloud"]')).toHaveCSS("background-image", "none")
    })
})
