import { test, expect, type Locator } from "./desk_fixture.ts"
import { readFile } from "node:fs/promises"

async function upload(window: Locator, name: string, value: string, mimeType = "text/plain") {
    await window.locator('input[type="file"]').setInputFiles({ name, mimeType, buffer: Buffer.from(value) })
}

test("empty split, shared editors, isolated scrolling and live sandboxed HTML preview", async ({ page }) => {
    await page.goto("/desk")
    await expect(page.locator("#main-content")).not.toHaveAttribute("inert", "")
    const parent = page.locator(".desk_wbox").nth(0)
    const original = "<h1>Shared draft</h1>\n" + "<p>line</p>\n".repeat(100)
    await upload(parent, "sample.html", original, "text/html")
    const source = parent.locator(".desk_wbox_body_text_input")
    await expect(source).toHaveValue(original)
    await expect(parent.locator('[data-mode="edit"]')).toHaveAttribute("aria-checked", "true")
    await source.fill(original.replace("draft", "unsaved"))
    await parent.locator(".desk_wbox_head_split").click()
    const child = page.locator(".desk_wbox").nth(1)
    await expect(child.locator(".desk_wbox_head_path")).toHaveValue("")
    await expect(child.locator('[data-mode][aria-checked="true"]')).toHaveCount(0)
    await expect(child.locator(".desk_wbox_body_empty_terminal")).toHaveCount(0)
    await expect(child.locator(".desk_wbox_body_empty_folder")).toBeVisible()
    await child.locator('[data-mode="edit"]').click()
    const target = child.locator(".desk_wbox_body_text_input")
    await expect(target).toHaveValue(original.replace("draft", "unsaved"))
    await parent.locator(".desk_wbox_body_text").evaluate(el => { el.scrollTop = 500 })
    await target.fill("<h1>From child</h1>\n" + "<p>line</p>\n".repeat(100))
    await expect(source).toHaveValue(/^<h1>From child/)
    expect(await parent.locator(".desk_wbox_body_text").evaluate(el => el.scrollTop)).toBeGreaterThan(0)
    expect(await child.locator(".desk_wbox_body_text").evaluate(el => el.scrollTop)).not.toBe(await parent.locator(".desk_wbox_body_text").evaluate(el => el.scrollTop))
    await child.locator('[data-mode="view"]').click()
    const frame = child.frameLocator("iframe")
    await expect(frame.locator("h1")).toHaveText("From child")
    await source.fill('<h1>Live preview</h1><script>parent.document.body.dataset.attacked="yes"</script>')
    await expect(frame.locator("h1")).toHaveText("Live preview")
    await expect(child.locator("iframe")).toHaveAttribute("sandbox", "")
    expect(await page.locator("body").getAttribute("data-attacked")).toBeNull()
    await child.locator('[data-mode="edit"]').click()
    await expect(target).toHaveValue(/Live preview/)
    await expect(child.locator(".desk_wbox_head_save")).toHaveClass(/is_dirty/)
    await child.locator(".desk_wbox_head_save").click()
    await expect(parent.locator(".desk_wbox_head_save")).not.toHaveClass(/is_dirty/)
    await page.screenshot({ path: ".cache/desk-browser-results/split-mirror.png" })
})

test("own split text resources compare additions and removals and react to source edits", async ({ page }) => {
    await page.goto("/desk")
    await expect(page.locator("#main-content")).not.toHaveAttribute("inert", "")
    const parent = page.locator(".desk_wbox").nth(0)
    await upload(parent, "source.txt", "same\nremoved\nend\n")
    await parent.locator(".desk_wbox_head_split").click()
    const child = page.locator(".desk_wbox").nth(1)
    await upload(child, "other.txt", "same\nadded\nend\n")
    await expect(child.locator('[data-comparison="ready"]')).toBeVisible()
    await expect(child.locator(".desk_diff_added")).toHaveText("added\n")
    await expect(child.locator(".desk_diff_removed")).toHaveAttribute("data-removed", "1")
    await parent.locator(".desk_wbox_body_text_input").fill("same\nadded\nend\n")
    await expect(child.locator(".desk_diff_added, .desk_diff_removed")).toHaveCount(0)
    await child.locator(".desk_wbox_body_text_input").fill("same\nnew line\n")
    await expect(parent.locator(".desk_wbox_body_text_input")).toHaveValue("same\nadded\nend\n")
    await expect(child.locator(".desk_diff_added")).toHaveText("new line\n")
    await page.screenshot({ path: ".cache/desk-browser-results/split-compare.png" })
})

test("text opens in edit mode; plain view is readonly and other text view unsupported", async ({ page }) => {
    for (const [name, mime] of [["notes.txt", "text/plain"], ["script.js", "text/javascript"], ["notes.md", "text/markdown"]]) {
        await page.goto("/desk")
    await expect(page.locator("#main-content")).not.toHaveAttribute("inert", "")
        const window = page.locator(".desk_wbox").first()
        await upload(window, name, "sample text", mime)
        await expect(window.locator('[data-mode="edit"]')).toHaveAttribute("aria-checked", "true")
        await window.locator(".desk_wbox_body_text_input").fill("unsaved draft")
        await window.locator('[data-mode="view"]').click()
        if (mime === "text/plain") {
            await expect(window.locator("textarea.desk_wbox_body_text_input")).toHaveValue("unsaved draft")
            await expect(window.locator("textarea.desk_wbox_body_text_input")).toHaveAttribute("readonly", "")
        } else await expect(window.locator(".desk_wbox_body_none")).toContainText("No viewer for")
        await window.locator('[data-mode="edit"]').click()
        await expect(window.locator(".desk_wbox_body_text_input")).toHaveValue("unsaved draft")
    }
})

test("image split runs img2pdf WASM and exposes a real PDF viewer and download", async ({ page }) => {
    test.setTimeout(120000)
    const requests: string[] = []
    page.on("request", request => { if (request.url().includes("pdf_suite")) requests.push(request.url()) })
    await page.goto("/desk")
    await expect(page.locator("#main-content")).not.toHaveAttribute("inert", "")
    const parent = page.locator(".desk_wbox").nth(0)
    const png = await page.evaluate(async () => {
        const canvas = document.createElement("canvas"); canvas.width = 64; canvas.height = 32
        const context = canvas.getContext("2d")!; context.fillStyle = "red"; context.fillRect(0, 0, 64, 32)
        return canvas.toDataURL().split(",")[1]
    })
    await parent.locator('input[type="file"]').setInputFiles({ name: "red.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") })
    await expect(parent).toHaveAttribute("data-plugin", "media")
    await parent.locator(".desk_wbox_head_split").click()
    const child = page.locator(".desk_wbox").nth(1)
    await child.locator(".desk_wbox_head_mime > summary").click()
    const search = child.locator(".list_drop_search input")
    await search.fill("application/pdf"); await search.press("Enter")
    await expect(child.locator('[data-pdf-ready="true"]')).toBeVisible({ timeout: 90000 })
    await expect(child.locator('[data-mode="view"]')).toHaveAttribute("aria-checked", "true")
    expect(requests.some(url => /pdf_suite.*wasm/.test(url))).toBe(true)
    const pending = page.waitForEvent("download")
    await child.getByRole("link", { name: "Download PDF", exact: true }).click()
    const download = await pending
    const bytes = await readFile((await download.path())!)
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-")
    expect(bytes.toString("latin1")).toContain("/Width 64 /Height 32")
    expect(bytes.toString("latin1")).toContain("/Filter /DCTDecode")
    const pixel = await child.locator("canvas").evaluate(canvas => [...(canvas as HTMLCanvasElement).getContext("2d")!.getImageData(10, 10, 1, 1).data])
    expect(pixel[0]).toBeGreaterThan(200); expect(pixel[1]).toBeLessThan(50); expect(pixel[2]).toBeLessThan(50)
    await page.screenshot({ path: ".cache/desk-browser-results/split-pdf.png" })
})


test("a split folder opens its own comparison resource and detaches from shared editing", async ({ page }) => {
    await page.goto("/desk")
    await expect(page.locator("#main-content")).not.toHaveAttribute("inert", "")
    await page.evaluate(async () => {
        const root = await navigator.storage.getDirectory()
        const stream = await (await root.getFileHandle("compare.txt", { create: true })).createWritable()
        await stream.write("same\nchild only\n"); await stream.close()
    })
    const parent = page.locator(".desk_wbox").nth(0)
    await upload(parent, "source.txt", "same\nsource only\n")
    await parent.locator(".desk_wbox_head_split").click()
    const child = page.locator(".desk_wbox").nth(1)
    await child.getByRole("button", { name: "Open folder", exact: true }).click()
    await child.locator('.desk_folder_tile[data-path="/home/user/compare.txt"]').click()
    await expect(child.locator('[data-comparison="ready"]')).toBeVisible()
    await expect(child.locator(".desk_diff_added")).toHaveText("child only\n")
    await expect(page.locator(".desk_wbox")).toHaveCount(2)
    await child.locator(".desk_wbox_body_text_input").fill("saved child\n")
    await child.locator(".desk_wbox_head_save").click()
    await expect(child.locator(".desk_wbox_head_save")).not.toHaveClass(/is_dirty/)
    await expect.poll(() => page.evaluate(async () => (await (await (await navigator.storage.getDirectory()).getFileHandle("compare.txt")).getFile()).text())).toBe("saved child\n")
    await expect(parent.locator(".desk_wbox_body_text_input")).toHaveValue("same\nsource only\n")
})

test("closing a parent preserves its mirrored unsaved draft, and unsupported conversion is explicit", async ({ page }) => {
    await page.goto("/desk")
    await expect(page.locator("#main-content")).not.toHaveAttribute("inert", "")
    const parent = page.locator(".desk_wbox").nth(0)
    await upload(parent, "draft.txt", "original")
    await parent.locator(".desk_wbox_body_text_input").fill("keep this draft")
    await parent.locator(".desk_wbox_head_split").click()
    const child = page.locator(".desk_wbox").nth(1)
    await child.locator('[data-mode="edit"]').click()
    await expect(child.locator(".desk_wbox_body_text_input")).toHaveValue("keep this draft")
    await parent.locator(".desk_wbox_body_text_input").click()
    await page.locator("#head_exit").click()
    const survivor = page.locator(".desk_wbox").first()
    await expect(page.locator(".desk_wbox")).toHaveCount(1)
    await expect(survivor.locator(".desk_wbox_body_text_input")).toHaveValue("keep this draft")
    await survivor.locator(".desk_wbox_head_split").click()
    const conversion = page.locator(".desk_wbox").nth(1)
    await conversion.locator(".desk_wbox_head_mime > summary").click()
    await conversion.locator(".list_drop_search input").fill("application/pdf")
    await conversion.locator(".list_drop_search input").press("Enter")
    await expect(conversion.locator(".desk_wbox_body_none")).toHaveText("No conversion from text/plain to application/pdf")
})


test("uploaded PDFs render multiple pages, zoom and retain Japanese viewer labels", async ({ page }) => {
    await page.goto("/ja/desk")
    const objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 64 32] /Contents 4 0 R >>",
        "<< /Length 24 >>\nstream\n1 0 0 rg 0 0 64 32 re f\nendstream",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 64 32] /Contents 6 0 R >>",
        "<< /Length 24 >>\nstream\n0 0 1 rg 0 0 64 32 re f\nendstream",
    ]
    let source = "%PDF-1.4\n"
    const offsets = [0]
    objects.forEach((value, index) => { offsets.push(Buffer.byteLength(source)); source += `${index + 1} 0 obj\n${value}\nendobj\n` })
    const xref = Buffer.byteLength(source)
    source += `xref\n0 7\n0000000000 65535 f \n${offsets.slice(1).map(offset => String(offset).padStart(10, "0") + " 00000 n \n").join("")}trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
    const window = page.locator(".desk_wbox").first()
    await upload(window, "two-pages.pdf", source, "application/pdf")
    const viewer = window.locator(".desk_pdf")
    await expect(viewer).toHaveAttribute("data-pdf-ready", "true", { timeout: 30000 })
    await expect(viewer.getByRole("link", { name: "PDFをダウンロード" })).toBeVisible()
    await expect(viewer.getByRole("button", { name: "前のページ" })).toBeDisabled()
    const pixel = () => viewer.locator("canvas").evaluate(canvas => [...(canvas as HTMLCanvasElement).getContext("2d")!.getImageData(10, 10, 1, 1).data])
    expect((await pixel())[0]).toBeGreaterThan(200)
    await viewer.getByRole("button", { name: "次のページ" }).click()
    await expect(viewer.getByRole("status")).toHaveText("2 / 2")
    expect((await pixel())[2]).toBeGreaterThan(200)
    expect((await pixel())[0]).toBeLessThan(50)
    await expect(viewer.getByRole("button", { name: "次のページ" })).toBeDisabled()
    const width = await viewer.locator("canvas").evaluate(canvas => (canvas as HTMLCanvasElement).width)
    await viewer.getByRole("button", { name: "拡大" }).click()
    await expect.poll(() => viewer.locator("canvas").evaluate(canvas => (canvas as HTMLCanvasElement).width)).toBeGreaterThan(width)
    const manifest = await (await page.request.get("/assets/pdfjs.json")).json()
    expect((await page.request.get(manifest.module)).headers()["content-type"]).toContain("javascript")
    expect((await page.request.get(manifest.base + "LICENSE")).status()).toBe(200)
})
