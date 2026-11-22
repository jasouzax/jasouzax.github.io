/** Accessible virtual-filesystem destination picker. Selection never creates or overwrites a file.
 * The caller writes only after checking that the original document is still current.
 */
import { text } from "../../index.ts"
import { resolve } from "../../fs/vfs.ts"
import { load_children, type fs_node, type dir_handle } from "../../fs/opfs.ts"
import { can_browse, can_create, check_permissions } from "../../fs/permissions.ts"

export type Save_Destination = { directory: fs_node, name: string, path: string }

export function save_name_valid(name: string): boolean {
    return Boolean(name.trim()) && name !== "." && name !== ".." && !/[\\/\x00-\x1f\x7f]/.test(name)
}

export async function pick_destination(name: string, current: () => boolean): Promise<Save_Destination | null> {
    const home = await resolve("/home/user")
    if (!home || !current()) throw new Error(text("files_cannot_edit"))
    return new Promise(resolve_pick => {
        const dialog = document.createElement("dialog")
        dialog.className = "desk_save_dialog"
        const form = document.createElement("form")
        const title = document.createElement("h2")
        title.id = "desk_save_title"; title.textContent = text("save_destination")
        dialog.setAttribute("aria-labelledby", title.id)
        const location = document.createElement("p")
        const up = document.createElement("button")
        up.type = "button"; up.textContent = text("folder_up")
        const folders = document.createElement("div")
        folders.className = "desk_save_folders"; folders.setAttribute("role", "group"); folders.setAttribute("aria-label", text("files_folder"))
        const label = document.createElement("label")
        label.textContent = text("files_name_label")
        const input = document.createElement("input")
        input.name = "filename"; input.required = true; input.value = save_name_valid(name) ? name : "untitled.txt"
        label.append(input)
        const status = document.createElement("p")
        status.setAttribute("role", "status")
        const overwrite = document.createElement("label"), confirm = document.createElement("input")
        confirm.type = "checkbox"; confirm.name = "overwrite"
        overwrite.append(confirm, document.createTextNode(text("save_overwrite"))); overwrite.hidden = true
        const save = document.createElement("button"), cancel = document.createElement("button")
        save.type = "submit"; save.textContent = text("save")
        cancel.type = "button"; cancel.textContent = text("files_cancel")
        form.append(title, location, up, folders, label, overwrite, status, save, cancel)
        dialog.append(form); document.body.append(dialog)
        let directory = home, generation = 0, ended = false, busy = false
        function done(value: Save_Destination | null): void {
            if (ended) return
            ended = true
            document.removeEventListener("jazu:page", cancel_pick)
            dialog.close(); dialog.remove(); resolve_pick(value)
        }
        const cancel_pick = () => done(null)
        document.addEventListener("jazu:page", cancel_pick)
        cancel.addEventListener("click", cancel_pick)
        dialog.addEventListener("cancel", event => { event.preventDefault(); done(null) })
        input.addEventListener("input", () => { overwrite.hidden = true; confirm.checked = false; status.textContent = "" })
        up.addEventListener("click", () => { if (directory.parent) void browse(directory.parent) })
        async function browse(next: fs_node): Promise<void> {
            const ticket = ++generation
            busy = true; save.disabled = true
            try {
                await load_children(next)
                await check_permissions([next])
                if (ended || ticket !== generation) return
                directory = next
                location.textContent = next.path
                up.disabled = !next.parent
                folders.replaceChildren()
                for (const child of next.children ?? []) {
                    if (child.kind !== "dir" || !can_browse(child)) continue
                    const button = document.createElement("button")
                    button.type = "button"; button.textContent = child.name
                    button.addEventListener("click", () => void browse(child))
                    folders.append(button)
                }
                status.textContent = can_create(next) ? "" : text("files_cannot_edit")
                overwrite.hidden = true; confirm.checked = false
                save.disabled = !can_create(next)
            } catch { status.textContent = text("files_failed") }
            finally { if (ticket === generation) busy = false }
        }
        form.addEventListener("submit", event => {
            event.preventDefault()
            if (busy || ended) return
            void (async () => {
                if (!current()) return done(null)
                if (!save_name_valid(input.value)) { status.textContent = text("files_bad_name"); input.focus(); return }
                busy = true; save.disabled = true
                try {
                    await check_permissions([directory])
                    if (!can_create(directory)) { status.textContent = text("files_cannot_edit"); return }
                    // Re-read the target to catch external writes after the folder was displayed.
                    await load_children(directory)
                    const existing = directory.children?.find(child => child.name === input.value)
                    if (existing?.kind === "dir") { status.textContent = text("files_exists"); return }
                    if (existing && (overwrite.hidden || !confirm.checked)) {
                        overwrite.hidden = false; status.textContent = text("files_exists"); confirm.focus(); return
                    }
                    if (!current() || ended) return done(null)
                    done({ directory, name: input.value, path: `${directory.path === "/" ? "" : directory.path}/${input.value}` })
                } catch { status.textContent = text("files_failed") }
                finally { busy = false; save.disabled = !can_create(directory) }
            })()
        })
        dialog.showModal()
        input.focus(); input.select()
        void browse(home)
    })
}

export async function write_destination(target: Save_Destination, blob: Blob): Promise<(blob: Blob) => Promise<void>> {
    await check_permissions([target.directory])
    if (!can_create(target.directory)) throw new Error(text("files_cannot_edit"))
    const handle = await (target.directory.handle as dir_handle).getFileHandle(target.name, { create: true })
    const write = async (value: Blob) => {
        if (!handle.createWritable) throw new Error(text("files_no_save"))
        const writer = await handle.createWritable()
        await writer.write(value); await writer.close()
    }
    await write(blob)
    return write
}
