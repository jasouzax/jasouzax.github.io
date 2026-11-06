import { test, expect } from "@playwright/test"

for (const width of [1440, 390]) {
    test(`slide skill tabs switch versions and restore history at ${width}px`, async ({ page }) => {
        test.setTimeout(60000)
        await page.setViewportSize({ width, height: 1000 })
        await page.goto("/#web-app/gdsc")
        await expect(page.locator("html")).not.toHaveAttribute("data-skeleton", /.+/, { timeout: 30000 })
        const web = page.locator('.slide[data-project="gdsc"] .variant_in_web-app')
        const cloud = page.locator('.slide[data-project="gdsc"] .variant_in_cloud')
        await expect(web).toBeVisible()
        await expect(cloud).toBeHidden()
        await expect(web.locator(".slide_desc")).toContainText("Vuetify")
        expect(await web.locator(".slide_img").evaluate(media => media.getBoundingClientRect().height)).toBeGreaterThan(100)
        const active = page.locator('.slide[data-project="gdsc"] .slide_skills').locator('[data-skill="web-app"]')
        await expect(active).toHaveAttribute("aria-current", "true")
        await expect(active).toHaveCSS("background-image", "none")
        await expect(page.locator('.slide[data-project="gdsc"] .slide_skills').locator('[data-skill="cloud"]')).toHaveCSS("background-image", /linear-gradient/)
        const project = page.locator('.slide[data-project="gdsc"]')
        await expect(project).toHaveCount(1)
        await expect(project.locator(".slide_name")).toHaveCount(1)
        await expect(project.locator(".slide_role")).toHaveCount(1)
        await expect(project.locator(".slide_skills")).toHaveCount(1)
        await expect(project.locator(".slide_actions")).toHaveCount(1)
        await expect(project.locator(".slide_variant .slide_actions")).toHaveCount(0)
        await expect(project.locator(".btn_website")).toHaveAttribute("href", "https://gdsc-usa.web.app")
        await expect(project.locator(".slide_variant .slide_top, .slide_variant .slide_role")).toHaveCount(0)
        await expect(page.locator('.dot.d_gdsc')).toHaveCount(1)
        await expect(page.locator('.tl_pin.p_gdsc')).toHaveCount(1)
        await expect.poll(() => project.evaluate(slide => {
            const card = slide.getBoundingClientRect()
            const track = slide.parentElement!.getBoundingClientRect()
            return Math.abs(card.left + card.width / 2 - track.left - track.width / 2)
        })).toBeLessThan(2)
        await project.evaluate(slide => {
            const samples: number[] = []
            const shared: number[] = []
            const shared_nodes = [".slide_name", ".slide_role", ".slide_actions"].map(selector => ({ selector, node: slide.querySelector(selector)! }))
            ;(window as any).sharedOpacity = shared
            ;(window as any).variantFadeStarted = false
            slide.addEventListener("transitionrun", event => {
                if ((event as TransitionEvent).propertyName === "opacity" && event.target === slide.querySelector(".variant_in_cloud")) {
                    ;(window as any).variantFadeStarted = true
                }
            })
            ;(window as any).variantMotion = new Promise<number[]>(resolve => {
                slide.addEventListener("click", () => {
                    const start = performance.now()
                    const sample = () => {
                        samples.push(slide.getBoundingClientRect().left - slide.parentElement!.getBoundingClientRect().left)
                        for (const { selector, node } of shared_nodes) {
                            if (node !== slide.querySelector(selector)) throw new Error("Shared project content was replaced")
                            shared.push(Number(getComputedStyle(node!).opacity))
                        }
                        if (performance.now() - start < 1800) requestAnimationFrame(sample)
                        else resolve(samples)
                    }
                    requestAnimationFrame(sample)
                }, { once: true, capture: true })
            })
        })
        await page.locator('.slide[data-project="gdsc"] .slide_skills').locator('[data-skill="cloud"]').click()
        const positions: number[] = await page.evaluate(() => (window as any).variantMotion)
        expect(Math.max(...positions) - Math.min(...positions)).toBeLessThan(2)
        await expect.poll(() => page.evaluate(() => (window as any).variantFadeStarted)).toBe(true)
        await expect(cloud).toHaveCSS("opacity", "1")
        const shared: number[] = await page.evaluate(() => (window as any).sharedOpacity)
        expect(shared.every(value => value === 1)).toBe(true)

        await expect(page).toHaveURL(/#cloud\/gdsc$/)
        await expect(cloud).toBeVisible()
        await expect(web).toBeHidden()
        await expect(cloud.locator(".slide_desc")).toContainText("Firestore")
        await expect(page.locator('.slide[data-project="gdsc"] .slide_skills').locator('[data-skill="cloud"]')).toHaveAttribute("aria-current", "true")
        await expect(page.locator('.slide[data-project="gdsc"] .slide_skills').locator('[data-skill="cloud"]')).toHaveCSS("background-image", "none")
        // Read both boxes in one frame while the fragment's smooth scroll is running.
        const [card, tabs] = await project.evaluate(slide => [".slide_card", ".slide_skills"].map(selector =>
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
    await page.goto("/?search=Firestore")
    await expect(page.locator("html")).not.toHaveAttribute("data-skeleton", /.+/, { timeout: 12000 })
    await expect(page.locator('.slide.hit[data-project="gdsc"]')).toHaveCount(1)
    await expect(page.locator('[id="search/gdsc"]')).toHaveCount(1)
    await expect(page.locator('.slide[data-project="gdsc"] .variant_in_cloud')).toBeVisible()
    await expect(page.locator('.slide[data-project="gdsc"] .slide_skills [data-skill="cloud"]')).toHaveAttribute("aria-current", "true")
    const web = page.locator('.slide[data-project="gdsc"] .variant_in_web-app')
    await page.locator('.slide[data-project="gdsc"] .slide_skills').locator('[data-skill="cloud"]').click()
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
    await expect(page.locator('.slide[data-project="gdsc"] .slide_skills').locator('[data-skill="cloud"]')).toHaveCSS("background-image", /linear-gradient/)
    await page.locator('.slide[data-project="gdsc"] .slide_skills').locator('[data-skill="cloud"]').click()
    const cloud = page.locator('.slide[data-project="gdsc"] .variant_in_cloud')
    await expect(cloud).toBeVisible()
    await expect(web).toBeHidden()
    await expect(cloud.locator(".slide_desc")).toContainText("Firestore")
    await expect(page.locator('.slide[data-project="gdsc"] .slide_skills').locator('[data-skill="cloud"]')).toHaveAttribute("aria-current", "true")
    await expect(page.locator('.slide[data-project="gdsc"] .slide_skills').locator('[data-skill="cloud"]')).toHaveCSS("background-image", "none")
})

test.describe("without JavaScript", () => {
    test.use({ javaScriptEnabled: false })
    test("skill links select the correct slide and active tab", async ({ page }) => {
        await page.goto("/#web-app/gdsc")
        const web = page.locator('.slide[data-project="gdsc"] .variant_in_web-app')
        await expect(web).toBeVisible()
        await page.locator('.slide[data-project="gdsc"] .slide_skills').locator('[data-skill="cloud"]').click()
        const cloud = page.locator('.slide[data-project="gdsc"] .variant_in_cloud')
        await expect(cloud).toBeVisible()
        await expect(web).toBeHidden()
        await expect(page.locator('.slide[data-project="gdsc"] .slide_skills').locator('[data-skill="cloud"]')).toHaveCSS("background-image", "none")
    })
})
