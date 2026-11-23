/* Compile pipeline-authored UI into a real project response and exercise its ordinary desk runtime. */
import { test, expect } from "./desk_fixture.ts"
import { parseHTML } from "linkedom"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"

test("pipeline windows restore inline data and local split links without publishing execution policy", async ({ page }) => {
    const markup = execFileSync(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./fixtures/pipeline_desk.ts", import.meta.url))], { encoding: "utf8", windowsHide: true })
    expect(markup).not.toContain("private-executable")
    await page.route(/\/projects\/stesis\/?$/, async route => {
        const response = await route.fetch(), original = parseHTML(await response.text()).document
        const replacement = parseHTML(`<html><body>${markup}</body></html>`).document.querySelector("#desk")!
        original.querySelector("#desk")!.replaceWith(replacement)
        await route.fulfill({ response, body: original.toString() })
    })
    await page.goto("/projects/stesis")
    const source = page.locator("#desk_win_2 textarea.desk_wbox_body_text_input"), mirror = page.locator("#desk_win_3 textarea.desk_wbox_body_text_input")
    await expect(source).toHaveValue("Inline pipeline draft")
    await expect(mirror).toHaveValue("Inline pipeline draft")
    await mirror.fill("Changed through the pipeline split")
    await expect(source).toHaveValue("Changed through the pipeline split")
    const menu = page.locator("#head_menu")
    if (await menu.getAttribute("open") === null) await menu.locator(":scope > summary").click()
    await page.locator(".desk_side_tabs_drop > summary").filter({ hasText: "Pipeline: staging" }).click()
    await expect(page.getByRole("link", { name: "Build reference" })).toHaveAttribute("href", "https://example.com/build")
})
