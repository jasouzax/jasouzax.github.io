/** End-to-end menu head geometry, manual/automatic maps, tab changes and window restoration. */
import { test, expect, type Page } from "./desk_fixture.ts"
import { parseHTML } from "linkedom"

async function fixture(page: Page, initial = false): Promise<void> {
    await page.route(/\/desk\/?$/, async route => {
        const response = await route.fetch()
        const { document } = parseHTML(await response.text())
        const desk = document.querySelector("#desk")!
        if (initial) desk.setAttribute("data-map-initial", "")
        document.querySelector(".desk_side_info")!.textContent = "A long description that wraps across many lines. ".repeat(12)
        const auto = document.createElement("details")
        document.querySelectorAll(".desk_map").forEach(map => map.remove())
        auto.className = "desk_map"; auto.setAttribute("data-map-auto", ""); auto.setAttribute("data-map-layout", "graph")
        document.querySelector(".desk_side_page")!.append(auto)
        const tabs = document.querySelector(".desk_side_tabs_ul")!
        const side = document.querySelector(".desk_side")!
        for (const [name, has_map] of [["Manual", true], ["No map", false]] as const) {
            const li = document.createElement("li"), tab = document.createElement("details"), summary = document.createElement("summary")
            tab.className = "desk_side_tabs_drop"; tab.setAttribute("name", "desk_side_tab"); summary.textContent = name
            tab.append(summary); li.append(tab); tabs.append(li)
            const panel = document.createElement("div"); panel.className = "desk_side_page"
            if (has_map) {
                const map = document.createElement("details"); map.className = "desk_map"; map.setAttribute("data-map-layout", "tree")
                const node = document.createElement("li"); node.setAttribute("data-map-node", "authored"); node.setAttribute("data-map-x", "45"); node.setAttribute("data-map-y", "50")
                const label = document.createElement("span"); label.className = "desk_map_label"
                const link = document.createElement("a"); link.href = "window:1"; link.textContent = "Original window"
                label.append(link); node.append(label); map.append(node); panel.append(map)
            }
            side.append(panel)
        }
        await route.fulfill({ response, body: document.toString() })
    })
    await page.goto("/desk")
}

test("menu description grows above tabs; maps pan, zoom, follow tabs and restore windows", async ({ page }) => {
    await fixture(page)
    await page.locator("#head_menu > summary").click()
    const info = await page.locator(".desk_side_info").boundingBox()
    const tabs = await page.locator(".desk_side_tabs").boundingBox()
    expect(info).not.toBeNull(); expect(tabs).not.toBeNull()
    expect(info!.y + info!.height).toBeLessThanOrEqual(tabs!.y + 1)
    const button = page.locator(".desk_side_mode"), windows = page.locator(".desk > .desk_wbox")
    const count = await windows.count()
    await button.click()
    await expect(button).toHaveText("Windows")
    await expect(windows.first()).toBeHidden()
    await expect(page.locator('[data-map-id="window:1"]')).toBeVisible()
    await page.locator('[data-map-action="in"]').click()
    const canvas = page.locator(".desk_map_canvas")
    await expect(canvas).toHaveCSS("transform", /matrix\(1\.2,/)
    const surface = page.locator(".desk_map_surface")
    await surface.focus(); await page.keyboard.press("ArrowLeft")
    await page.locator('[data-map-action="reset"]').click()
    await expect(canvas).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)")
    await page.getByText("Manual", { exact: true }).click()
    await expect(page.locator('[data-map-id="authored"]')).toHaveCSS("left", "45px")
    await expect(page.locator('[data-map-id="window:1"]')).toHaveCount(0)
    await page.getByRole("link", { name: "Original window" }).click()
    await expect(windows.first()).toBeVisible()
    await expect(button).toHaveText("Map")
    await button.click()
    await page.getByText("No map", { exact: true }).click()
    await expect(button).toBeHidden()
    await expect(page.locator(".desk_map_view")).toBeHidden()
    await expect(windows.first()).toBeVisible()
    await expect(windows).toHaveCount(count)
})

test("initial map mode exits when a window tab is activated and rehydrates after navigation", async ({ page }) => {
    await fixture(page, true)
    await expect(page.locator("#desk")).toHaveAttribute("data-display-mode", "map")
    await page.locator("#head_tabs a[data-desk-tab]").first().click()
    await expect(page.locator("#desk")).toHaveAttribute("data-display-mode", "window")
    await expect(page.locator(".desk > .desk_wbox").first()).toBeVisible()
    await page.reload()
    await expect(page.locator(".desk_map_view")).toHaveCount(1)
    await expect(page.locator("#desk")).toHaveAttribute("data-display-mode", "map")
})

test("portrait map supports pointer panning and window creation returns to window mode", async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 900 })
    await fixture(page, true)
    const surface = page.locator(".desk_map_surface"), canvas = page.locator(".desk_map_canvas")
    const rect = (await surface.boundingBox())!
    const x = rect.x + rect.width - 25, y = rect.y + 125
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x - 60, y - 40); await page.mouse.up()
    await expect(canvas).toHaveCSS("transform", "matrix(1, 0, 0, 1, -60, -40)")
    await page.keyboard.press("Control+Enter")
    await expect(page.locator("#desk")).toHaveAttribute("data-display-mode", "window")
    await expect(page.locator(".desk > .desk_wbox:visible")).toHaveCount(1)
})

test("map node placement persists by menu and follows pointer and keyboard movement", async ({ page }) => {
    await fixture(page)
    await page.locator("#head_menu > summary").click()
    await page.getByText("Manual", { exact: true }).click()
    await page.locator(".desk_side_mode").click()
    const card = page.locator('[data-map-id="authored"]')
    const rect = (await card.boundingBox())!
    await page.mouse.move(rect.x + 180, rect.y + 60); await page.mouse.down()
    await page.mouse.move(rect.x + 230, rect.y + 90); await page.mouse.up()
    await expect(card).toHaveCSS("left", "95px")
    await expect(card).toHaveCSS("top", "80px")
    await card.locator("a").focus()
    await page.keyboard.press("Shift+ArrowRight")
    await expect(card).toHaveCSS("left", "105px")
    await page.reload()
    await page.locator("#head_menu > summary").click()
    await page.getByText("Manual", { exact: true }).click()
    await page.locator(".desk_side_mode").click()
    await expect(card).toHaveCSS("left", "105px")
    await expect(card).toHaveCSS("top", "80px")
})

test("automatic maps bind live processes and restore their existing terminal", async ({ page }) => {
    await page.goto("/desk")
    const source = page.locator(".desk_wbox_head_path").first()
    await source.fill("pid:"); await source.press("Enter")
    await expect(page.locator(".xterm-screen")).toBeVisible({ timeout: 45000 })
    await page.locator("#head_menu > summary").click()
    await page.locator(".desk_side_mode").click()
    const process = page.locator('[data-map-id^="pid:"]')
    await expect(process).toHaveCount(1)
    await expect(process.locator("a")).toHaveAttribute("href", /^pid:\d+$/)
    await process.locator("a").click()
    await expect(page.locator(".desk > .desk_wbox")).toHaveCount(1)
    await expect(page.locator(".xterm-screen")).toBeVisible()
    await expect(source).toHaveValue(/^pid:/)
})
