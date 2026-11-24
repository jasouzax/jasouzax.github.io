import { test, expect } from "./desk_fixture.ts"
test("selected-child conversion menu produces resized rotated images and saves output", async ({ page }) => {
    await page.goto("/desk")
    const parent = page.locator(".desk_wbox").first()
    const png = await page.evaluate(() => {
        const canvas = document.createElement("canvas"); canvas.width = 20; canvas.height = 10
        const context = canvas.getContext("2d")!; context.fillStyle = "red"; context.fillRect(0, 0, 20, 10)
        return canvas.toDataURL().split(",")[1]
    })
    await parent.locator('input[type="file"]').setInputFiles({ name: "red.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") })
    await parent.locator(".desk_wbox_head_split").click()
    const child = page.locator(".desk_wbox").nth(1), tab = page.locator('.desk_side_tabs_drop[data-path="desk:conversion"]')
    await expect(tab).toBeVisible(); await tab.locator("summary").click()
    const menu = page.locator(".desk_conversion_menu")
    await menu.getByLabel("Output MIME").selectOption("image/webp")
    await expect(child).toHaveAttribute("data-converted", "image-webp")
    await menu.locator('[name="image_width"]').fill("40")
    await menu.locator('[name="image_rotation"]').fill("90")
    await menu.getByRole("button", { name: "Apply conversion" }).click()
    await expect.poll(async () => child.locator("img").evaluate(async image => {
        await (image as HTMLImageElement).decode(); return [(image as HTMLImageElement).naturalWidth, (image as HTMLImageElement).naturalHeight]
    })).toEqual([20, 40])
    await expect(child.locator(".desk_wbox_head_save")).toBeEnabled()
    await parent.locator(".desk_wbox_head_path").click()
    await expect(tab).toBeHidden()
    await expect(parent.locator("img")).toHaveJSProperty("naturalWidth", 20)
})
