import { test, expect } from "@playwright/test"

for (const width of [1440, 390]) {
    test(`slide skill tabs switch versions and restore history at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 1000 })
        await page.goto("/#web-app/gdsc")
        await expect(page.locator("html")).not.toHaveAttribute("data-skeleton", /.+/, { timeout: 12000 })
        // Keep software WebGL from consuming the frames used to measure the fade.
        await page.evaluate(() => {
            const layer = document.querySelector<HTMLElement>("#theme_background .background")
            const theme = (window as any).jazu_theme_modules?.default
            if (layer && theme) theme.mount(layer, { name: "default", mode: "auto" }).pause()
        })
        const web = page.locator('.slide[data-project="gdsc"] .variant_in_web-app')
        const cloud = page.locator('.slide[data-project="gdsc"] .variant_in_cloud')
        await expect(web).toBeVisible()
        await expect(cloud).toBeHidden()
        await expect(web.locator(".slide_desc")).toContainText("Vuetify")
        expect(await web.locator(".slide_img").evaluate(media => media.getBoundingClientRect().height)).toBeGreaterThan(100)
        const active = web.locator('[data-skill="web-app"]')
        await expect(active).toHaveAttribute("aria-current", "true")
        await expect(active).toHaveCSS("background-image", "none")
        await expect(web.locator('[data-skill="cloud"]')).toHaveCSS("background-image", /linear-gradient/)
        const project = page.locator('.slide[data-project="gdsc"]')
        await expect(project).toHaveCount(1)
        await expect(page.locator('.dot.d_gdsc')).toHaveCount(1)
        await expect(page.locator('.tl_pin.p_gdsc')).toHaveCount(1)
        await expect.poll(() => project.evaluate(slide => {
            const card = slide.getBoundingClientRect()
            const track = slide.parentElement!.getBoundingClientRect()
            return Math.abs(card.left + card.width / 2 - track.left - track.width / 2)
        })).toBeLessThan(2)
        await project.evaluate(slide => {
            const samples: number[] = []
            const opacity: number[] = []
            ;(window as any).variantOpacity = opacity
            ;(window as any).variantMotion = new Promise<number[]>(resolve => {
                slide.addEventListener("click", () => {
                    const start = performance.now()
                    const sample = () => {
                        samples.push(slide.getBoundingClientRect().left - slide.parentElement!.getBoundingClientRect().left)
                        opacity.push(Number(getComputedStyle(slide.querySelector(".variant_in_cloud")!).opacity))
                        if (performance.now() - start < 600) requestAnimationFrame(sample)
                        else resolve(samples)
                    }
                    requestAnimationFrame(sample)
                }, { once: true, capture: true })
            })
        })
        await web.locator('[data-skill="cloud"]').click()
        const positions: number[] = await page.evaluate(() => (window as any).variantMotion)
        expect(Math.max(...positions) - Math.min(...positions)).toBeLessThan(2)
        const opacity: number[] = await page.evaluate(() => (window as any).variantOpacity)
        expect(opacity.some(value => value > 0 && value < 1)).toBe(true)

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

test("search returns one project with matching variations and skill links leave search", async ({ page }) => {
    await page.goto("/?search=GDSC")
    await expect(page.locator("html")).not.toHaveAttribute("data-skeleton", /.+/, { timeout: 12000 })
    await expect(page.locator('.slide.hit[data-project="gdsc"]')).toHaveCount(1)
    await expect(page.locator('[id="search/gdsc"]')).toHaveCount(1)
    const web = page.locator('.slide[data-project="gdsc"] .variant_in_web-app')
    await web.locator('[data-skill="cloud"]').click()
    await expect(page).toHaveURL(/\/#cloud\/gdsc$/)
    await expect(page.locator(".expertise")).not.toHaveClass(/is_searching/)
    await expect(page.locator('.slide[data-project="gdsc"] .variant_in_cloud')).toBeVisible()
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
    const web = page.locator('.slide[data-project="gdsc"] .variant_in_web-app')
    await expect(web.locator('[data-skill="cloud"]')).toHaveCSS("background-image", /linear-gradient/)
    await web.locator('[data-skill="cloud"]').click()
    const cloud = page.locator('.slide[data-project="gdsc"] .variant_in_cloud')
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
        const web = page.locator('.slide[data-project="gdsc"] .variant_in_web-app')
        await expect(web).toBeVisible()
        await web.locator('[data-skill="cloud"]').click()
        const cloud = page.locator('.slide[data-project="gdsc"] .variant_in_cloud')
        await expect(cloud).toBeVisible()
        await expect(web).toBeHidden()
        await expect(cloud.locator('[data-skill="cloud"]')).toHaveCSS("background-image", "none")
    })
})
