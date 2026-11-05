import type { desk_window } from "./desk.ts"
import { state, text } from "./desk.ts"
import { folder_action_enabled, perform_folder_action, type folder_action, type fs_node } from "./desk_fs.ts"
import { resolve } from "./desk_vfs.ts"
import { check_permissions } from "./desk_fs_permissions.ts"
import { import_entries } from "./desk_folder_drop.ts"
import { local_file_path } from "./desk_paths.ts"

const labels: Record<folder_action, string> = {
    new_file: "files_new_file", new_folder: "files_new_folder", paste: "files_paste", upload: "files_upload",
    rename: "files_rename", copy: "files_copy", cut: "files_cut", download: "files_download", delete: "files_delete",
}
const icons: Record<folder_action, string> = { new_file: "file_new", new_folder: "folder_new", paste: "paste", upload: "upload", rename: "rename", copy: "copy", cut: "cut", download: "download", delete: "delete" }

export function bind_folder_context(item: desk_window, body: HTMLElement, status: HTMLElement, signal: AbortSignal): () => void {
    let menu: HTMLElement | null = null, form: HTMLFormElement | null = null
    let revision = 0
    const close = () => { revision++; menu?.remove(); menu = null }
    const report = (error: unknown) => { if (!signal.aborted) status.textContent = error instanceof Error ? error.message : text("files_failed") }
    const execute = async (action: folder_action, dir: fs_node, entry: fs_node | null, value = "") => {
        try { await perform_folder_action(action, dir, entry ? [entry] : [], value) }
        catch (error) { report(error); throw error }
    }
    const ask = (action: "rename" | "new_file" | "new_folder" | "delete", dir: fs_node, entry: fs_node | null) => {
        form?.remove()
        const dialog = document.createElement("form")
        form = dialog; dialog.className = "desk_folder_form"; dialog.setAttribute("role", "dialog"); dialog.setAttribute("aria-label", text(labels[action]))
        const label = document.createElement("label")
        label.textContent = action === "delete" ? `${text("files_confirm_delete")} ${entry?.name ?? ""}` : text(labels[action])
        let input: HTMLInputElement | null = null
        if (action !== "delete") {
            input = document.createElement("input"); input.type = "text"; input.autocomplete = "off"
            input.value = action === "rename" ? entry?.name ?? "" : ""; input.setAttribute("aria-label", text("files_name"))
            label.append(input)
        }
        const submit = document.createElement("button"); submit.type = "submit"; submit.textContent = text(action === "delete" ? "files_delete" : "files_ok")
        const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = text("files_cancel")
        cancel.addEventListener("click", () => { dialog.remove(); if (form === dialog) form = null })
        dialog.append(label, submit, cancel)
        dialog.addEventListener("submit", event => {
            event.preventDefault(); submit.disabled = true
            void execute(action, dir, entry, input?.value.trim() ?? "").then(() => { dialog.remove(); if (form === dialog) form = null }).catch(() => {}).finally(() => { submit.disabled = false })
        })
        dialog.addEventListener("keydown", event => { if (event.key === "Escape") cancel.click() })
        body.insertBefore(dialog, body.querySelector(".desk_folder_grid"))
        ;(input ?? cancel).focus(); input?.select()
    }
    const upload = (dir: fs_node) => {
        const picker = document.createElement("input"); picker.type = "file"; picker.multiple = true
        picker.addEventListener("change", () => {
            if (signal.aborted) return
            const files = [...(picker.files ?? [])]
            void import_entries(dir, files.map(file => ({ kind: "file", name: file.name, file: async () => file }))).catch(report)
        })
        picker.click()
    }
    const context = async (event: MouseEvent) => {
        if ((event.target as Element).closest("input, textarea, .desk_folder_form")) return
        event.preventDefault()
        document.dispatchEvent(new Event("jazu:folder:context-open"))
        const current = ++revision
        const path = (event.target as Element).closest<HTMLElement>(".desk_folder_entry")?.dataset.path
        const dir = await resolve(local_file_path(item.path) ?? "/")
        const entry = path ? await resolve(path) : null
        if (!dir || (path && !entry)) return
        const destination = entry?.kind === "dir" ? entry : dir
        await check_permissions([destination, ...(entry ? [entry] : [])])
        if (signal.aborted || current !== revision) return
        const popup = document.createElement("div")
        menu = popup; popup.className = "desk_folder_context"; popup.setAttribute("role", "menu"); popup.setAttribute("aria-label", text("folder_context_menu"))
        const groups: folder_action[][] = []
        if (!entry || entry.kind === "dir") groups.push(["new_file", "new_folder", "paste", "upload"])
        if (entry) groups.push(["rename", "copy", "cut", "download", "delete"])
        for (const [index, actions] of groups.entries()) {
            if (index) { const separator = document.createElement("div"); separator.setAttribute("role", "separator"); popup.append(separator) }
            for (const action of actions) {
                const button = document.createElement("button"); button.type = "button"; button.setAttribute("role", "menuitem"); button.dataset.folderAction = action
                button.disabled = !folder_action_enabled(action, destination, entry ? [entry] : [])
                const icon = document.createElement("span"); icon.setAttribute("aria-hidden", "true"); icon.textContent = state.data?.icons?.[icons[action]] ?? ""
                button.append(icon, document.createTextNode(text(labels[action])))
                button.addEventListener("click", () => {
                    close()
                    if (["rename", "new_file", "new_folder", "delete"].includes(action)) ask(action as "rename" | "new_file" | "new_folder" | "delete", destination, entry)
                    else if (action === "upload") upload(destination)
                    else void execute(action, destination, entry).catch(() => {})
                })
                popup.append(button)
            }
        }
        document.body.append(popup)
        popup.style.left = `${Math.max(8, Math.min(event.clientX, innerWidth - popup.offsetWidth - 8))}px`
        popup.style.top = `${Math.max(8, Math.min(event.clientY, innerHeight - popup.offsetHeight - 8))}px`
        popup.querySelector<HTMLButtonElement>("button:enabled")?.focus()
    }
    const outside = (event: Event) => { if (!menu?.contains(event.target as Node)) close() }
    const key = (event: KeyboardEvent) => {
        if (!menu) return
        if (event.key === "Escape" || event.key === "Tab") { close(); return }
        const buttons = [...menu.querySelectorAll<HTMLButtonElement>("button:enabled")]
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
        const index = event.key === "ArrowDown" ? (current + 1) % buttons.length : event.key === "ArrowUp" ? (current + buttons.length - 1) % buttons.length : event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : -1
        if (index >= 0 && buttons[index]) { event.preventDefault(); buttons[index].focus() }
    }
    const show = (event: MouseEvent) => { void context(event).catch(report) }
    body.addEventListener("contextmenu", show)
    document.addEventListener("pointerdown", outside, true)
    document.addEventListener("click", outside, true)
    document.addEventListener("contextmenu", outside, true)
    document.addEventListener("jazu:folder:context-open", close)
    document.addEventListener("keydown", key)
    signal.addEventListener("abort", () => {
        close(); form?.remove(); body.removeEventListener("contextmenu", show)
        document.removeEventListener("pointerdown", outside, true); document.removeEventListener("click", outside, true)
        document.removeEventListener("contextmenu", outside, true)
        document.removeEventListener("jazu:folder:context-open", close); document.removeEventListener("keydown", key)
    }, { once: true })
    return close
}
