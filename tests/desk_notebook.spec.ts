/* Notebook document editing/save, safe stored outputs, shared mirrors and Markdown live preview. */
import { test, expect, type Page, type Locator } from "./desk_fixture.ts"
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jQ2kAAAAASUVORK5CYII="
function sample() {
    return { nbformat: 4, nbformat_minor: 5, metadata: { kernelspec: { name: "python3" }, custom: { keep: true } }, future_root: "preserve", cells: [
        { id: "intro", cell_type: "markdown", metadata: { authored: true }, source: ["# Notebook\n", "![Pixel](attachment:pixel.png) ![Remote](https://notebook.invalid/tracker.png)"], attachments: { "pixel.png": { "image/png": png } } },
        { id: "code", cell_type: "code", metadata: {}, source: "print(1)", execution_count: 7, outputs: [
            { output_type: "stream", name: "stdout", text: "1\n", keep_output: "yes" },
            { output_type: "display_data", data: { "text/html": '<script>globalThis.notebookExecuted=true</script><img src="https://notebook.invalid/html.png">' }, metadata: {} },
        ] },
    ] }
}
async function open_notebook(page: Page): Promise<Locator> {
    await page.route("**/sample.ipynb", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(sample()) }))
    await page.goto("/desk")
    const window = page.locator(".desk_wbox").first()
    const source = window.locator(".desk_wbox_head_path")
    await source.fill("/sample.ipynb"); await source.press("Enter")
    await expect(window.locator(".notebook_cell")).toHaveCount(2)
    return window
}
async function save_as(page: Page, window: Locator, name: string) {
    await window.locator(".desk_wbox_head_save").click()
    const dialog = page.getByRole("dialog", { name: "Save to folder" })
    await dialog.locator('input[name="filename"]').fill(name)
    await dialog.getByRole("button", { name: "Save", exact: true }).click()
    await expect(dialog).toHaveCount(0)
}
async function stored(page: Page, name: string) {
    return page.evaluate(async name => JSON.parse(await (await (await (await navigator.storage.getDirectory()).getFileHandle(name)).getFile()).text()), name)
}

test("notebook cells edit, reorder, undo and save without dropping metadata, attachments or stored output", async ({ page }) => {
    let external = 0
    await page.route("https://notebook.invalid/**", route => { external++; return route.abort() })
    const window = await open_notebook(page)
    await expect(window.locator(".notebook_image, .notebook_preview img")).toHaveCount(1)
    await expect.poll(() => window.locator(".notebook_preview img").evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(1)
    await expect(window.locator("iframe, .desk_notebook script")).toHaveCount(0)
    expect(await page.evaluate(() => (globalThis as any).notebookExecuted)).toBeUndefined()
    expect(external).toBe(0)
    await window.getByRole("textbox", { name: "Cell 1 source", exact: true }).fill("# Edited heading\n\nAuthored paragraph")
    await expect(window.locator(".notebook_preview h1")).toHaveText("Edited heading")
    await window.getByRole("textbox", { name: "Cell 2 source", exact: true }).fill("print(2)")
    await window.locator('[data-cell-index="1"] [data-note-action="up"]').click()
    await expect(window.getByRole("textbox", { name: "Cell 1 source", exact: true })).toHaveValue("print(2)")
    await window.locator('[data-note-action="add-raw"]').click()
    await window.getByRole("textbox", { name: "Cell 3 source", exact: true }).fill("Raw document text")
    await window.locator('[data-cell-index="2"] [data-note-action="delete"]').click()
    await expect(window.locator(".notebook_cell")).toHaveCount(2)
    await window.locator('[data-note-action="undo"]').click()
    await expect(window.getByRole("textbox", { name: "Cell 3 source", exact: true })).toHaveValue("Raw document text")
    await window.locator('[data-note-action="redo"]').click()
    await expect(window.locator(".notebook_cell")).toHaveCount(2)
    await save_as(page, window, "edited.ipynb")
    const saved = await stored(page, "edited.ipynb")
    expect(saved.metadata).toEqual(sample().metadata)
    expect(saved.future_root).toBe("preserve")
    expect(saved.cells.map((cell: any) => cell.id)).toEqual(["code", "intro"])
    expect(saved.cells[0].outputs).toEqual(sample().cells[1].outputs)
    expect(saved.cells[0].execution_count).toBe(7)
    expect(saved.cells[1].attachments).toEqual(sample().cells[0].attachments)
    await window.locator('[data-cell-index="0"] [data-note-action="clear-outputs"]').click()
    await window.locator(".desk_wbox_head_save").click()
    await expect.poll(async () => (await stored(page, "edited.ipynb")).cells[0].outputs).toEqual([])
    expect((await stored(page, "edited.ipynb")).cells[0].execution_count).toBeNull()
    await page.reload()
    const path = page.locator(".desk_wbox_head_path").first()
    await path.fill("file:///home/user/edited.ipynb"); await path.press("Enter")
    await expect(page.getByRole("textbox", { name: "Cell 1 source", exact: true })).toHaveValue("print(2)")
    await page.screenshot({ path: ".cache/notebook-editor.png", fullPage: true })
})

test("notebook mirrors share edits, render read-only cells and clear dirty state when another mirror saves", async ({ page }) => {
    const parent = await open_notebook(page)
    await parent.locator(".desk_wbox_head_split").click()
    const child = page.locator(".desk_wbox").nth(1)
    await child.locator('[data-mode="edit"]').click()
    const source = parent.getByRole("textbox", { name: "Cell 2 source", exact: true })
    await source.fill("print(42)")
    await expect(child.getByRole("textbox", { name: "Cell 2 source", exact: true })).toHaveValue("print(42)")
    await child.locator('[data-mode="view"]').click()
    await expect(child.locator(".notebook_input")).toHaveCount(0)
    await expect(child.locator(".notebook_source")).toHaveText("print(42)")
    await parent.getByRole("textbox", { name: "Cell 1 source", exact: true }).fill("# Live preview")
    await expect(child.locator(".notebook_prose h1")).toHaveText("Live preview")
    await child.locator('[data-mode="edit"]').click()
    await save_as(page, child, "mirror.ipynb")
    await expect(parent.locator(".desk_wbox_head_save")).not.toHaveClass(/is_dirty/)
    expect((await stored(page, "mirror.ipynb")).cells[1].source).toBe("print(42)")
})

test("saving an untouched notebook preserves its exact original JSON bytes", async ({ page }) => {
    const window = await open_notebook(page)
    await save_as(page, window, "unchanged.ipynb")
    const bytes = await page.evaluate(async () => (await (await (await navigator.storage.getDirectory()).getFileHandle("unchanged.ipynb")).getFile()).text())
    expect(bytes).toBe(JSON.stringify(sample()))
})

test("invalid notebooks preserve raw bytes and Markdown previews follow unsaved edits", async ({ page }) => {
    await page.goto("/desk")
    const window = page.locator(".desk_wbox").first(), invalid = '{ "nbformat": 4, "private_value": "preserve me" }'
    await window.locator('input[type="file"]').setInputFiles({ name: "broken.ipynb", mimeType: "application/json", buffer: Buffer.from(invalid) })
    await expect(window.locator(".notebook_status")).toContainText("Unsupported or invalid")
    await expect(window.locator(".desk_wbox_head_save")).toBeDisabled()
    await window.locator(".desk_wbox_head_mime > summary").click()
    await window.locator('[data-mime="application/json"]').click()
    await expect(window.locator(".desk_wbox_body_text_input")).toHaveValue(invalid)
    await page.reload()
    const fresh = page.locator(".desk_wbox").first()
    await fresh.locator('input[type="file"]').setInputFiles({ name: "readme.md", mimeType: "text/markdown", buffer: Buffer.from("# Original") })
    const editor = fresh.locator(".desk_wbox_body_text_input")
    await expect(editor).toHaveValue("# Original")
    await fresh.locator(".desk_wbox_head_split").click()
    const preview = page.locator(".desk_wbox").nth(1)
    await preview.locator('[data-mode="view"]').click()
    await editor.fill("# Unsaved Markdown\n\n**Live text**")
    await expect(preview.locator(".desk_wbox_body_doc h1")).toHaveText("Unsaved Markdown")
    await expect(preview.locator(".desk_wbox_body_doc strong")).toHaveText("Live text")
})
