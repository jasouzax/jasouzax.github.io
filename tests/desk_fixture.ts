// Desk input APIs can target inert controls. Wait for the real loading lifecycle before issuing navigation-dependent edits.
import { test as base, expect as base_expect } from "@playwright/test"
export { type Page, type Locator } from "@playwright/test"

export const expect = base_expect.configure({ timeout: 15000 })

export const test = base.extend({
    page: async ({ page }, use) => {
        const goto = page.goto.bind(page), reload = page.reload.bind(page)
        const ready = async () => {
            await expect(page.locator("#main-content")).not.toHaveAttribute("inert", "", { timeout: 30000 })
        }
        page.goto = async (...args) => { const response = await goto(...args); await ready(); return response }
        page.reload = async (...args) => { const response = await reload(...args); await ready(); return response }
        await use(page)
    },
})
