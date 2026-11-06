import { test, expect as base_expect, type Page, type Locator } from "@playwright/test"
const expect = base_expect.configure({ timeout: 15000 })

// Use native handles in a separate storage bucket so reads, writes, serialization,
// and restoration exercise the browser API without automating an OS picker.
async function picker(page: Page) {
    await page.addInitScript(() => {
        Object.defineProperty(FileSystemFileHandle.prototype, "move", { configurable: true, value: async () => { throw new DOMException("Native moves unavailable", "NotSupportedError") } })
        Object.defineProperty(window, "showDirectoryPicker", { configurable: true, value: async (options: unknown) => {
            ;(window as any).picker_options = options
            return (await (navigator as any).storageBuckets.open("connected-home")).getDirectory()
        } })
    })
}
async function connect(page: Page) {
    await page.locator("#head_account > summary").click()
    await page.getByRole("button", { name: "Connect to Folder", exact: true }).click()
    await expect(page.getByRole("button", { name: /^Disconnect folder/ })).toBeEnabled()
    await expect(page.locator("[data-folder-status]")).toBeHidden()
    await page.locator("#head_account > summary").click()
}
async function open(pane: Locator, path: string) {
    await expect(pane.page().locator("#main-content")).not.toHaveAttribute("inert", "")
    const input = pane.locator(".desk_wbox_head_path")
    await input.fill(`file://${path}`); await input.press("Enter")
}
async function target_text(page: Page, path: string) {
    return page.evaluate(async path => {
        let dir = await (await (navigator as any).storageBuckets.open("connected-home")).getDirectory()
        const parts = path.split("/")
        for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part)
        return (await (await dir.getFileHandle(parts.at(-1))).getFile()).text()
    }, path)
}

test("project terminals keep their working directory when home connects to a folder", async ({ page }) => {
    test.setTimeout(120000)
    await picker(page)
    await page.goto("/projects/galactic-strike")
    await connect(page)
    const directory = page.locator('.desk_side_item[data-path="/srv/projects/galactic-strike"] > details > summary')
    await expect(directory).toHaveAttribute("data-focused", "")
    await page.keyboard.press("Control+Enter")
    await page.locator(".desk_wbox").last().getByRole("button", { name: "Open terminal", exact: true }).click()
    const screen = page.locator(".xterm-rows")
    await expect(screen).toContainText("user@jasouza:/srv/projects/galactic-strike$")
    const input = page.locator(".xterm-helper-textarea")
    await input.pressSequentially("ls; echo LIST_STATUS_$?; echo connected-project > /home/user/project.txt; cd; pwd")
    await input.press("Enter")
    await expect(screen).toContainText("LIST_STATUS_0")
    await expect(screen).toContainText("user@jasouza:/home/user$")
    await expect.poll(() => target_text(page, "project.txt")).toBe("connected-project\n")
    await page.reload()
    await expect(page.locator(".desk_wbox_head_path").first()).toHaveValue("file:///srv/projects/galactic-strike")
    const pane = page.locator(".desk_wbox").first()
    await expect(pane.locator(".desk_folder_status")).toHaveText("Empty")
    await open(pane, "/home/user/project.txt")
    await expect(pane.locator(".desk_wbox_body_text_input")).toHaveValue("connected-project\n")
})

test("connecting home preserves conflicts, editor drafts, previews and the saved connection", async ({ page }) => {
    test.setTimeout(120000)
    await picker(page)
    await page.goto("/desk")
    await page.evaluate(async () => {
        const original = await navigator.storage.getDirectory()
        const chosen = await (await (navigator as any).storageBuckets.open("connected-home")).getDirectory()
        const write = async (dir: FileSystemDirectoryHandle, name: string, data: string) => {
            const stream = await (await dir.getFileHandle(name, { create: true })).createWritable()
            await stream.write(data); await stream.close()
        }
        await write(original, "notes.txt", "original notes")
        await write(await original.getDirectoryHandle("project", { create: true }), "main.c", "int x;")
        await write(chosen, "notes.txt", "existing chosen notes")
        await write(chosen, "notes (1).txt", "another existing note")
        await write(await chosen.getDirectoryHandle("project", { create: true }), "README.txt", "existing project")
    })
    const pane = page.locator(".desk_wbox").first()
    await open(pane, "/home/user/notes.txt")
    await expect(pane.locator(".desk_wbox_body_text_input")).toHaveValue("original notes")
    await pane.locator('[data-mode="edit"]').click()
    await pane.locator(".desk_wbox_body_text_input").fill("unsaved draft")
    await connect(page)
    expect(await page.evaluate(() => (window as any).picker_options)).toEqual({ id: "jazu-home", mode: "readwrite" })
    await expect(pane.locator(".desk_wbox_head_path")).toHaveValue("file:///home/user/notes (2).txt")
    await expect(pane.locator(".desk_wbox_body_text_input")).toHaveValue("unsaved draft")
    await pane.locator(".desk_wbox_head_save").click()
    await expect.poll(() => target_text(page, "notes (2).txt")).toBe("unsaved draft")
    expect(await target_text(page, "notes.txt")).toBe("existing chosen notes")
    expect(await target_text(page, "notes (1).txt")).toBe("another existing note")
    expect(await target_text(page, "project (1)/main.c")).toBe("int x;")
    expect(await target_text(page, "project/README.txt")).toBe("existing project")
    expect(await page.evaluate(async () => {
        const names: string[] = []
        for await (const entry of (await navigator.storage.getDirectory() as any).values()) names.push(entry.name)
        return names
    })).toEqual([])
    await open(pane, "/home/user")
    await expect(pane.locator('.desk_folder_tile[data-path="/home/user/notes (2).txt"] .desk_folder_text')).toContainText("unsaved draft")
    await expect.poll(() => page.evaluate(async () => {
        const root = await (await (navigator as any).storageBuckets.open("connected-home")).getDirectory()
        const dir = await (await root.getDirectoryHandle(".cache")).getDirectoryHandle("previews")
        let count = 0; for await (const file of dir.values()) count++
        return count
    })).toBeGreaterThan(0)
    await page.reload()
    await open(pane, "/home/user")
    await expect(pane.locator('.desk_folder_tile[data-path="/home/user/notes (2).txt"]')).toBeVisible()
    await page.locator("#head_account > summary").click()
    await expect(page.getByRole("button", { name: /^Disconnect folder/ })).toBeVisible()
    await page.locator("#head_account > summary").click()
    // Restoring the same directory must not re-import stale private storage.
    await expect(pane.locator('.desk_folder_tile[data-path="/home/user/notes (3).txt"]')).toHaveCount(0)
    expect(await target_text(page, "notes (2).txt")).toBe("unsaved draft")
})

test("account connection works outside the desk and all file operations write through", async ({ page }) => {
    test.setTimeout(120000)
    await picker(page)
    await page.goto("/")
    await page.locator("#head_account > summary").click()
    await expect(page.locator("#head_account [role=separator]")).toBeVisible()
    await page.locator("#head_account > summary").click()
    await connect(page)
    await page.goto("/desk")
    const pane = page.locator(".desk_wbox").first()
    await open(pane, "/home/user")
    const background = () => pane.locator(".desk_folder_grid").click({ button: "right", position: { x: 8, y: 8 } })
    const action = (name: string) => page.getByRole("menuitem", { name, exact: true })
    const form = pane.locator(".desk_folder_form")
    const tile = (name: string) => pane.locator(`.desk_folder_tile[data-path="/home/user/${name}"]`)
    await background(); await action("New folder").click()
    await form.locator("input").fill("created"); await form.locator("input").press("Enter")
    await expect(tile("created")).toBeVisible()
    // Use the status background below the tiles for the upload menu.
    await pane.locator(".desk_folder_status").click({ button: "right" })
    const chooser = page.waitForEvent("filechooser"); await action("Upload").click()
    await (await chooser).setFiles({ name: "upload.txt", mimeType: "text/plain", buffer: Buffer.from("uploaded live") })
    await expect(tile("upload.txt")).toBeVisible()
    expect(await target_text(page, "upload.txt")).toBe("uploaded live")
    await tile("upload.txt").click({ button: "right" }); await action("Rename").click()
    await form.locator("input").fill("renamed.txt"); await form.locator("input").press("Enter")
    await expect(tile("renamed.txt")).toBeVisible()
    await tile("renamed.txt").click({ button: "right" }); await action("Cut").click()
    await tile("created").click({ button: "right" }); await action("Paste").click()
    await expect(tile("renamed.txt")).toHaveCount(0)
    expect(await target_text(page, "created/renamed.txt")).toBe("uploaded live")
    await page.locator("#head_new").click()
    await page.locator(".desk_wbox").last().getByRole("button", { name: "Open terminal", exact: true }).click()
    const screen = page.locator(".xterm-rows")
    await expect(screen).toContainText("user@jasouza:")
    await page.locator(".xterm-helper-textarea").pressSequentially("echo shell-live > /home/user/shell.txt; rm /home/user/created/renamed.txt; echo FSA_DONE")
    await page.keyboard.press("Enter")
    await expect(screen.locator(":scope > div").filter({ hasText: /^FSA_DONE\s*$/ })).toBeVisible({ timeout: 30000 })
    expect(await target_text(page, "shell.txt")).toBe("shell-live\n")
    expect(await page.evaluate(async () => {
        const dir = await (await (await (navigator as any).storageBuckets.open("connected-home")).getDirectory()).getDirectoryHandle("created")
        try { await dir.getFileHandle("renamed.txt"); return true } catch { return false }
    })).toBe(false)
    await page.reload(); await open(pane, "/home/user")
    await expect(tile("shell.txt")).toBeVisible()
})

test("cancelled and unsupported folder pickers leave home intact", async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(window, "showDirectoryPicker", { configurable: true, value: async () => { throw new DOMException("Cancelled", "AbortError") } }))
    await page.goto("/desk")
    await page.locator("#head_account > summary").click()
    const button = page.getByRole("button", { name: "Connect to Folder", exact: true })
    await button.click(); await expect(button).toBeEnabled()
    await expect(page.locator("[data-folder-status]")).toBeHidden()
    await page.addInitScript(() => Object.defineProperty(window, "showDirectoryPicker", { configurable: true, value: undefined }))
    await page.reload(); await page.locator("#head_account > summary").click()
    await expect(button).toBeDisabled()
    await expect(button).toHaveAttribute("title", /does not support/)
})

test("revoked connection permissions disconnect without restoring transferred private files", async ({ page }) => {
    await picker(page)
    await page.addInitScript(() => {
        const query = (FileSystemDirectoryHandle.prototype as any).queryPermission
        ;(FileSystemDirectoryHandle.prototype as any).queryPermission = async function(options: unknown) {
            const chosen = await (await (navigator as any).storageBuckets.open("connected-home")).getDirectory()
            if (sessionStorage.getItem("revoke-home") && await this.isSameEntry(chosen)) return "prompt"
            return query.call(this, options)
        }
    })
    await page.goto("/desk")
    await page.evaluate(async () => {
        const stream = await (await (await navigator.storage.getDirectory()).getFileHandle("stale.txt", { create: true })).createWritable()
        await stream.write("private original"); await stream.close()
    })
    await connect(page)
    await page.evaluate(() => sessionStorage.setItem("revoke-home", "1"))
    // Revocation in site settings is observed without a reload, even if the
    // browser reports prompt rather than denied after removing the grant.
    await page.evaluate(() => window.dispatchEvent(new Event("focus")))
    await page.locator("#head_account > summary").click()
    await expect(page.getByRole("button", { name: "Connect to Folder", exact: true })).toBeEnabled()
    await page.locator("#head_account > summary").click()
    await open(page.locator(".desk_wbox").first(), "/home/user")
    await expect(page.locator('.desk_folder_tile[data-path="/home/user/stale.txt"]')).toHaveCount(0)
    await page.locator("#head_menu > summary").click()
    for (const name of ["New file", "New folder", "Upload"]) await expect(page.locator(".desk_files_bar").getByRole("button", { name, exact: true })).toBeEnabled()
    await page.reload()
    await page.locator("#head_account > summary").click()
    await expect(page.getByRole("button", { name: "Connect to Folder", exact: true })).toBeEnabled()
})

test("external changes and hidden mode update both folder views, and disconnect persists", async ({ page }) => {
    await picker(page)
    await page.goto("/desk")
    await connect(page)
    const pane = page.locator(".desk_wbox").first()
    await open(pane, "/home/user")
    await page.locator("#head_menu > summary").click()
    await page.evaluate(async () => {
        const root = await (await (navigator as any).storageBuckets.open("connected-home")).getDirectory()
        await root.getFileHandle("external.txt", { create: true })
        await root.getFileHandle(".secret", { create: true })
        await root.getDirectoryHandle(".private", { create: true })
    })
    const tile = (name: string) => pane.locator(`.desk_folder_tile[data-path="/home/user/${name}"]`)
    const side = (name: string) => page.locator(`.desk_side_item[data-path="/home/user/${name}"]`)
    await expect(tile("external.txt")).toBeVisible()
    await expect(side("external.txt")).toBeVisible()
    await expect(tile(".secret")).toBeVisible()
    await pane.locator(".desk_folder_status").click({ button: "right" })
    const toggle = page.getByRole("menuitemcheckbox", { name: "Toggle hidden", exact: true })
    await expect(toggle).toHaveAttribute("aria-checked", "false")
    await toggle.click()
    await expect(tile(".secret")).toHaveCount(0)
    await expect(side(".secret")).toHaveCount(0)
    await expect(tile(".private")).toHaveCount(0)
    await expect(side(".private")).toHaveCount(0)
    await pane.locator(".desk_folder_status").click({ button: "right" })
    await expect(toggle).toHaveAttribute("aria-checked", "true")
    await toggle.click()
    await expect(tile(".secret")).toBeVisible()
    await page.evaluate(async () => {
        const root = await (await (navigator as any).storageBuckets.open("connected-home")).getDirectory()
        await root.removeEntry("external.txt")
    })
    await expect(tile("external.txt")).toHaveCount(0)
    await expect(side("external.txt")).toHaveCount(0)
    await page.reload()
    await page.locator("#head_account > summary").click()
    await page.getByRole("button", { name: /^Disconnect folder/ }).click()
    await expect(page.getByRole("button", { name: "Connect to Folder", exact: true })).toBeEnabled()
    await page.reload()
    await page.locator("#head_account > summary").click()
    await expect(page.getByRole("button", { name: "Connect to Folder", exact: true })).toBeEnabled()
    expect(await target_text(page, ".secret")).toBe("")
})

test("a new tab can authorize its saved folder without picking or copying it again", async ({ page, context }) => {
    await picker(page)
    await context.addInitScript(() => {
        const query = (FileSystemDirectoryHandle.prototype as any).queryPermission
        ;(FileSystemDirectoryHandle.prototype as any).queryPermission = async function(this: FileSystemDirectoryHandle, options: unknown) {
            const root = await (await (navigator as any).storageBuckets.open("connected-home")).getDirectory()
            if (await this.isSameEntry(root) && sessionStorage.getItem("permission-pending") && !sessionStorage.getItem("permission-restored")) return "prompt"
            return query.call(this, options)
        }
        ;(FileSystemDirectoryHandle.prototype as any).requestPermission = async function() {
            sessionStorage.setItem("permission-restored", "1")
            return "granted"
        }
    })
    await page.goto("/desk")
    await connect(page)
    await page.close()
    const next = await context.newPage()
    await next.addInitScript(() => sessionStorage.setItem("permission-pending", "1"))
    await next.goto("/desk")
    await next.locator("#head_account > summary").click()
    await expect(next.getByRole("button", { name: /^Disconnect folder/ })).toBeVisible()
    await next.getByRole("button", { name: "Allow folder access", exact: true }).click()
    await expect(next.getByRole("button", { name: "Allow folder access", exact: true })).toBeHidden()
    await next.locator("#head_account > summary").click()
    const pane = next.locator(".desk_wbox").first()
    await open(pane, "/home/user")
    await pane.locator(".desk_folder_status").click({ button: "right" })
    await next.getByRole("menuitem", { name: "New file", exact: true }).click()
    await pane.locator(".desk_folder_form input").fill("restored.txt")
    await pane.locator(".desk_folder_form input").press("Enter")
    await expect(pane.locator('.desk_folder_tile[data-path="/home/user/restored.txt"]')).toBeVisible()
    await next.locator("#head_new").click()
    await next.locator(".desk_wbox").last().getByRole("button", { name: "Open terminal", exact: true }).click()
    const screen = next.locator(".xterm-rows")
    await expect(screen).toContainText("user@jasouza:")
    await next.locator(".xterm-helper-textarea").pressSequentially("touch hi; echo hi > hi; echo again >> hi; echo RESTORED_DONE")
    await next.keyboard.press("Enter")
    await expect(screen.locator(":scope > div").filter({ hasText: /^RESTORED_DONE\s*$/ })).toBeVisible({ timeout: 30000 })
    expect(await target_text(next, "hi")).toBe("hi\nagain\n")
})

test("connecting shows progress and transferred files cannot return after deletion and reconnecting", async ({ page }) => {
    await picker(page)
    await page.addInitScript(() => {
        const choose = (window as any).showDirectoryPicker
        ;(window as any).showDirectoryPicker = () => new Promise(resolve => {
            ;(window as any).finish_picker = async () => resolve(await choose())
        })
    })
    await page.goto("/")
    await page.evaluate(async () => {
        const root = await navigator.storage.getDirectory()
        const writer = await (await root.getFileHandle("transfer.txt", { create: true })).createWritable()
        await writer.write("transfer me"); await writer.close()
        const folder = await root.getDirectoryHandle("nested", { create: true })
        await folder.getFileHandle("nested.txt", { create: true })
    })
    await page.locator("#head_account > summary").click()
    await page.getByRole("button", { name: "Connect to Folder", exact: true }).click()
    const connecting = page.getByRole("button", { name: "Connecting folder…", exact: true })
    await expect(connecting).toBeDisabled()
    await expect(page.locator("[data-folder-status]")).toBeHidden()
    await page.evaluate(() => (window as any).finish_picker())
    await expect(page.getByRole("button", { name: /^Disconnect folder/ })).toBeEnabled()
    await expect(page.locator("[data-folder-status]")).toBeHidden()
    expect(await target_text(page, "transfer.txt")).toBe("transfer me")
    expect(await target_text(page, "nested/nested.txt")).toBe("")
    expect(await page.evaluate(async () => {
        const entries = []
        for await (const entry of (await navigator.storage.getDirectory() as any).values()) entries.push(entry.name)
        return entries
    })).toEqual([])
    await page.evaluate(async () => {
        const root = await (await (navigator as any).storageBuckets.open("connected-home")).getDirectory()
        const names = []
        for await (const entry of root.values()) names.push(entry.name)
        for (const name of names) await root.removeEntry(name, { recursive: true })
    })
    await page.getByRole("button", { name: /^Disconnect folder/ }).click()
    await expect(page.getByRole("button", { name: "Connect to Folder", exact: true })).toBeEnabled()
    await page.getByRole("button", { name: "Connect to Folder", exact: true }).click()
    await expect(connecting).toBeDisabled()
    await page.evaluate(() => (window as any).finish_picker())
    await expect(page.getByRole("button", { name: /^Disconnect folder/ })).toBeEnabled()
    expect(await page.evaluate(async () => {
        const root = await (await (navigator as any).storageBuckets.open("connected-home")).getDirectory()
        const entries = []
        for await (const entry of root.values()) entries.push(entry.name)
        return entries
    })).toEqual([])
})

test("a failed transfer keeps all OPFS originals and restores the connect label", async ({ page }) => {
    await picker(page)
    await page.addInitScript(() => {
        const get_file = FileSystemDirectoryHandle.prototype.getFileHandle
        let copies = 0
        FileSystemDirectoryHandle.prototype.getFileHandle = async function(name, options) {
            const chosen = await (await (navigator as any).storageBuckets.open("connected-home")).getDirectory()
            if (options?.create && await this.isSameEntry(chosen) && ++copies === 2) throw new DOMException("Transfer failed", "NotAllowedError")
            return get_file.call(this, name, options)
        }
    })
    await page.goto("/")
    await page.evaluate(async () => {
        const root = await navigator.storage.getDirectory()
        for (const name of ["first.txt", "fail.txt"]) {
            const writer = await (await root.getFileHandle(name, { create: true })).createWritable()
            await writer.write(name); await writer.close()
        }
    })
    await page.locator("#head_account > summary").click()
    await page.getByRole("button", { name: "Connect to Folder", exact: true }).click()
    await expect(page.locator("[data-folder-status]")).toContainText("Transfer failed")
    await expect(page.getByRole("button", { name: "Connect to Folder", exact: true })).toBeEnabled()
    expect(await page.evaluate(async () => {
        const root = await navigator.storage.getDirectory()
        return Promise.all(["first.txt", "fail.txt"].map(async name => (await (await root.getFileHandle(name)).getFile()).text()))
    })).toEqual(["first.txt", "fail.txt"])
    expect(await page.evaluate(async () => {
        const root = await (await (navigator as any).storageBuckets.open("connected-home")).getDirectory()
        let count = 0
        for await (const entry of root.values()) {
            if (await (await entry.getFile()).text() === entry.name) count++
        }
        return count
    })).toBe(1)
})
