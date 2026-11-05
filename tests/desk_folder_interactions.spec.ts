import { test, expect, type Page, type Locator } from "@playwright/test"

const pane = (page: Page, index = 0) => page.locator(".desk_wbox").nth(index)
const tile = (window: Locator, path: string) => window.locator(`.desk_folder_tile[data-path="${path}"]`)
const menu = (page: Page) => page.getByRole("menu", { name: "Folder actions", exact: true })
const action = (page: Page, name: string) => menu(page).getByRole("menuitem", { name, exact: true })
async function open(window: Locator, path: string) {
    await window.locator(".desk_wbox_head_path").fill(`file://${path}`)
    await window.locator(".desk_wbox_head_path").press("Enter")
    await expect(window).toHaveAttribute("data-plugin", "folder")
    await expect(window.locator(".desk_folder_location")).toHaveText(path)
}
async function background(window: Locator) {
    const grid = window.locator(".desk_folder_grid")
    const bounds = (await grid.boundingBox())!
    await grid.click({ button: "right", position: { x: bounds.width / 2, y: bounds.height - 16 } })
}

test("folder covers track direct files without propagating nested changes", async ({ page }) => {
    await page.goto("/desk")
    await page.evaluate(async () => {
        const root = await navigator.storage.getDirectory()
        const covers = await root.getDirectoryHandle("covers", { create: true })
        for (const name of ["A", "B", "Empty"]) await covers.getDirectoryHandle(name, { create: true })
        for (const name of ["A", "B"]) {
            const folder = await covers.getDirectoryHandle(name)
            const deep = await folder.getDirectoryHandle("Deep", { create: true })
            const writer = await (await deep.getFileHandle("nested.js", { create: true })).createWritable()
            await writer.write("const nested = 1"); await writer.close()
        }
        const writer = await (await (await covers.getDirectoryHandle("A")).getFileHandle("one.js", { create: true })).createWritable()
        await writer.write("const direct = 1"); await writer.close()
    })
    const window = pane(page), a = tile(window, "/home/user/covers/A"), b = tile(window, "/home/user/covers/B")
    await open(window, "/home/user/covers")
    await expect(a).toHaveAttribute("data-preview", "cover")
    await expect(a).toHaveAttribute("data-cover-files", JSON.stringify(["/home/user/covers/A/one.js"]))
    await expect(a.locator(".desk_folder_cover img")).toHaveCount(1)
    await expect(a.locator(".desk_folder_glyph")).toHaveAttribute("data-double", "true")
    await expect(b).toHaveAttribute("data-preview", "cover")
    await expect(b.locator(".desk_folder_cover img")).toHaveCount(0)
    await expect(b.locator(".desk_folder_glyph")).toHaveAttribute("data-double", "true")
    await expect(tile(window, "/home/user/covers/Empty").locator(".desk_folder_glyph")).toHaveAttribute("data-double", "false")
    const original = await a.locator(".desk_folder_cover img").getAttribute("src")
    await b.evaluate(element => element.setAttribute("data-marker", "preserved"))
    await page.screenshot({ path: ".cache/desk-browser-results/folder-covers-light.png" })
    const lightShadow = await a.locator(".desk_folder_glyph").evaluate(element => getComputedStyle(element).filter)
    await page.emulateMedia({ colorScheme: "dark" })
    await expect.poll(() => a.locator(".desk_folder_glyph").evaluate(element => getComputedStyle(element).filter)).not.toBe(lightShadow)
    await page.screenshot({ path: ".cache/desk-browser-results/folder-covers-dark.png" })
    await page.locator("#head_new").click()
    const editor = pane(page, 1)
    const edit = async (path: string, value: string) => {
        await editor.locator(".desk_wbox_head_path").fill(`file://${path}`)
        await editor.locator(".desk_wbox_head_path").press("Enter")
        await editor.locator('[data-mode="edit"]').click()
        await editor.locator(".desk_wbox_body_text_input").fill(value)
        await editor.locator(".desk_wbox_head_save").click()
        await expect(editor.locator(".desk_wbox_head_save")).not.toHaveClass(/is_dirty/)
    }
    await edit("/home/user/covers/A/Deep/nested.js", "const nested = 2")
    await page.waitForTimeout(250)
    await expect(a.locator(".desk_folder_cover img")).toHaveAttribute("src", original!)
    await edit("/home/user/covers/A/one.js", "const direct = 2")
    await expect(a.locator(".desk_folder_cover img")).not.toHaveAttribute("src", original!)
    await expect(b).toHaveAttribute("data-marker", "preserved")
    await page.locator("#head_exit").click()
    await a.click({ button: "right" }); await action(page, "New file").click()
    const form = window.locator(".desk_folder_form")
    await form.locator("input").fill("added.txt"); await form.locator("input").press("Enter")
    await expect(a).toHaveAttribute("data-cover-count", "2")
    await expect(a.locator(".desk_folder_cover img")).toHaveCount(2)
    await page.locator("#head_exit").click()
    await page.locator("#head_new").click()
    const contents = pane(page, 1)
    await open(contents, "/home/user/covers/A")
    for (const name of ["added.txt", "one.js"]) {
        await tile(contents, `/home/user/covers/A/${name}`).click({ button: "right" }); await action(page, "Delete").click()
        await contents.locator(".desk_folder_form").getByRole("button", { name: "Delete", exact: true }).click()
        await expect(tile(contents, `/home/user/covers/A/${name}`)).toHaveCount(0)
    }
    await expect(a).toHaveAttribute("data-cover-count", "0")
    await expect(a.locator(".desk_folder_cover img")).toHaveCount(0)
    await expect(a.locator(".desk_folder_glyph")).toHaveAttribute("data-double", "true")
})

test("folder context menus target the clicked directory and share file actions and clipboard", async ({ page }) => {
    await page.goto("/desk")
    await page.evaluate(async () => {
        const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle("work", { create: true })
        await dir.getDirectoryHandle("child", { create: true })
        const writer = await (await dir.getFileHandle("a.txt", { create: true })).createWritable()
        await writer.write("alpha"); await writer.close()
    })
    const window = pane(page)
    await open(window, "/home/user/work")
    await background(window)
    await expect(menu(page).getByRole("menuitem")).toHaveText([/New file$/, /New folder$/, /Paste$/, /Upload$/])
    await expect(action(page, "Paste")).toBeDisabled()
    await action(page, "New file").click()
    const form = window.locator(".desk_folder_form")
    await form.locator("input").fill("new.txt"); await form.locator("input").press("Enter")
    await expect(tile(window, "/home/user/work/new.txt")).toBeVisible()
    await expect(page.locator(".desk_wbox")).toHaveCount(2)
    await page.locator("#head_exit").click()
    await background(window); await action(page, "New folder").click()
    await form.locator("input").fill("created"); await form.locator("input").press("Enter")
    await expect(tile(window, "/home/user/work/created")).toBeVisible()
    await tile(window, "/home/user/work/child").click({ button: "right" })
    await expect(menu(page).getByRole("menuitem")).toHaveText([/New file$/, /New folder$/, /Paste$/, /Upload$/, /Rename$/, /Copy$/, /Cut$/, /Download$/, /Delete$/])
    await action(page, "New file").click()
    await form.locator("input").fill("inside.txt"); await form.locator("input").press("Enter")
    await expect(page.locator(".desk_wbox")).toHaveCount(2)
    await expect(pane(page, 1).locator(".desk_wbox_head_path")).toHaveValue("file:///home/user/work/child/inside.txt")
    await page.locator("#head_exit").click()
    await tile(window, "/home/user/work/a.txt").click({ button: "right" })
    await expect(menu(page).getByRole("menuitem")).toHaveText([/Rename$/, /Copy$/, /Cut$/, /Download$/, /Delete$/])
    await action(page, "Rename").click()
    await form.locator("input").fill("b.txt"); await form.locator("input").press("Enter")
    await expect(tile(window, "/home/user/work/b.txt")).toBeVisible()
    await tile(window, "/home/user/work/b.txt").click({ button: "right" }); await action(page, "Copy").click()
    await background(window); await action(page, "Paste").click()
    await expect(tile(window, "/home/user/work/b (1).txt")).toBeVisible()
    await tile(window, "/home/user/work/b (1).txt").click({ button: "right" }); await action(page, "Cut").click()
    await tile(window, "/home/user/work/child").click({ button: "right" }); await action(page, "Paste").click()
    await expect(tile(window, "/home/user/work/b (1).txt")).toHaveCount(0)
    expect(await page.evaluate(async () => {
        const work = await (await navigator.storage.getDirectory()).getDirectoryHandle("work")
        return (await (await (await work.getDirectoryHandle("child")).getFileHandle("b (1).txt")).getFile()).text()
    })).toBe("alpha")
    await tile(window, "/home/user/work/b.txt").click({ button: "right" })
    const downloaded = page.waitForEvent("download"); await action(page, "Download").click()
    expect((await downloaded).suggestedFilename()).toBe("b.txt")
    await background(window)
    const chooser = page.waitForEvent("filechooser"); await action(page, "Upload").click()
    await (await chooser).setFiles({ name: "uploaded.txt", mimeType: "text/plain", buffer: Buffer.from("uploaded") })
    await expect(tile(window, "/home/user/work/uploaded.txt")).toBeVisible()
    await tile(window, "/home/user/work/b.txt").click({ button: "right" }); await action(page, "Delete").click()
    await form.getByRole("button", { name: "Delete", exact: true }).click()
    await expect(tile(window, "/home/user/work/b.txt")).toHaveCount(0)
    await background(window); await page.mouse.click(500, 12); await expect(menu(page)).toHaveCount(0)
    await background(window); await page.keyboard.press("Escape"); await expect(menu(page)).toHaveCount(0)
    await open(window, "/bin")
    await background(window); await expect(menu(page).locator("button:disabled")).toHaveCount(4)
    await tile(window, "/bin/cat").click({ button: "right" })
    for (const name of ["Rename", "Cut", "Delete"]) await expect(action(page, name)).toBeDisabled()
    for (const name of ["Copy", "Download"]) await expect(action(page, name)).toBeEnabled()
    expect(await page.locator(".desk_wbox_head").evaluate(element => {
        const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true }); element.dispatchEvent(event); return event.defaultPrevented
    })).toBe(false)
    await expect(menu(page)).toHaveCount(0)
})

test("folder drops move sidebar and tile entries and upload external files and directory trees", async ({ page }) => {
    await page.goto("/desk")
    await page.evaluate(async () => {
        const root = await navigator.storage.getDirectory()
        const source = await root.getDirectoryHandle("source", { create: true })
        const target = await root.getDirectoryHandle("target", { create: true })
        await target.getDirectoryHandle("into", { create: true })
        for (const name of ["tile.txt", "side-a.txt", "side-b.txt"]) {
            const writer = await (await source.getFileHandle(name, { create: true })).createWritable(); await writer.write(name); await writer.close()
        }
        const nested = await source.getDirectoryHandle("tree", { create: true })
        await nested.getDirectoryHandle("empty", { create: true })
        const writer = await (await nested.getFileHandle("inside.txt", { create: true })).createWritable(); await writer.write("inside"); await writer.close()
    })
    const source = pane(page)
    await open(source, "/home/user/source")
    await page.locator("#head_new").click()
    const target = pane(page, 1)
    await open(target, "/home/user/target")
    await tile(source, "/home/user/source/tile.txt").dragTo(target.locator(".desk_folder_grid"))
    await expect(tile(target, "/home/user/target/tile.txt")).toBeVisible()
    await expect(tile(source, "/home/user/source/tile.txt")).toHaveCount(0)
    await tile(source, "/home/user/source/tree").dragTo(tile(target, "/home/user/target/into"))
    await expect(tile(source, "/home/user/source/tree")).toHaveCount(0)
    expect(await page.evaluate(async () => {
        const root = await navigator.storage.getDirectory()
        const dir = await (await (await root.getDirectoryHandle("target")).getDirectoryHandle("into")).getDirectoryHandle("tree")
        await dir.getDirectoryHandle("empty")
        return (await (await dir.getFileHandle("inside.txt")).getFile()).text()
    })).toBe("inside")
    await page.locator("#head_menu > summary").click()
    const heads = (name: string) => page.locator(`.desk_side_item[data-path="/home/user/source/${name}"] > details > summary`)
    await heads("side-a.txt").click({ position: { x: 60, y: 8 } })
    await heads("side-b.txt").click({ position: { x: 60, y: 8 }, modifiers: ["Control"] })
    await heads("side-a.txt").dragTo(target.locator(".desk_folder_grid"))
    for (const name of ["side-a.txt", "side-b.txt"]) {
        await expect(tile(target, `/home/user/target/${name}`)).toBeVisible()
        await expect(tile(source, `/home/user/source/${name}`)).toHaveCount(0)
    }
    await target.locator(".desk_folder_grid").evaluate(element => {
        const data = new DataTransfer(); data.items.add(new File(["from computer"], "external.txt", { type: "text/plain" }))
        element.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: data }))
    })
    await expect(tile(target, "/home/user/target/external.txt")).toBeVisible()
    await target.locator(".desk_folder_grid").evaluate(element => {
        const leaf = { name: "leaf.txt", isDirectory: false, file: (done: (file: File) => void) => done(new File(["legacy file"], "leaf.txt")) }
        const empty = { name: "empty", isDirectory: true, createReader: () => ({ readEntries: (done: (entries: unknown[]) => void) => done([]) }) }
        const directory = { name: "computer-folder", isDirectory: true, createReader: () => {
            let batch = 0
            return { readEntries: (done: (entries: unknown[]) => void) => done(batch++ === 0 ? [leaf] : batch === 2 ? [empty] : []) }
        } }
        const data = { types: ["Files"], items: [{ kind: "file", webkitGetAsEntry: () => directory, getAsFile: () => null }], files: [] }
        const event = new DragEvent("drop", { bubbles: true, cancelable: true }); Object.defineProperty(event, "dataTransfer", { value: data }); element.dispatchEvent(event)
    })
    await expect(tile(target, "/home/user/target/computer-folder")).toBeVisible()
    expect(await page.evaluate(async () => {
        const root = await navigator.storage.getDirectory()
        const dir = await (await root.getDirectoryHandle("target")).getDirectoryHandle("computer-folder")
        await dir.getDirectoryHandle("empty")
        return (await (await dir.getFileHandle("leaf.txt")).getFile()).text()
    })).toBe("legacy file")
    await target.locator(".desk_folder_grid").evaluate(element => {
        const file = { kind: "file", name: "modern.txt", getFile: async () => new File(["modern handle"], "modern.txt") }
        const directory = { kind: "directory", name: "computer-folder", values: async function* () { yield file } }
        const data = { types: ["Files"], items: [{ kind: "file", getAsFileSystemHandle: async () => directory, webkitGetAsEntry: () => { throw new Error("unavailable") }, getAsFile: () => null }], files: [] }
        const event = new DragEvent("drop", { bubbles: true, cancelable: true }); Object.defineProperty(event, "dataTransfer", { value: data }); element.dispatchEvent(event)
    })
    await expect(tile(target, "/home/user/target/computer-folder (1)")).toBeVisible()
    expect(await page.evaluate(async () => {
        const root = await navigator.storage.getDirectory()
        const dir = await (await root.getDirectoryHandle("target")).getDirectoryHandle("computer-folder (1)")
        return (await (await dir.getFileHandle("modern.txt")).getFile()).text()
    })).toBe("modern handle")
    await expect(page.locator(".desk_wbox")).toHaveCount(2)
})
