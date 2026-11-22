import type { desk_window } from "../index.ts"
import { text, refresh_tab } from "../index.ts"
import { document_of, latest_bytes, is_dirty, accept_save } from "../plugin/flow.ts"
import { head_part } from "../window/head.ts"
import { pick_destination, write_destination } from "./save/destination.ts"
import { refresh_dir } from "../fs/opfs.ts"
import { sync_navigation } from "./history.ts"

const pending = new WeakSet<desk_window>()

// ---- save (the button in the head) ---------------------------------------------------------------------------------------------
// The button is enabled while the window has an editor with something valid to save, and is marked while the editor holds a change that
// has not been saved. Read-only and new documents choose a virtual-filesystem destination before any write.

export function sync_save(item: desk_window): void {
    const button = head_part<HTMLButtonElement>(item, ".desk_wbox_head_save")
    if (!button) return
    const ready = item.commit !== null && item.problem === ""
    button.disabled = !ready || pending.has(document_of(item))
    button.classList.toggle("is_dirty", item.commit !== null && item.dirty)
    button.title = item.problem !== "" ? item.problem : item.dirty && item.commit ? text("unsaved") : text("save")
    button.setAttribute("aria-label", button.title)
}

export function announce(item: desk_window, message: string): void {
    let live = item.el.querySelector<HTMLElement>(".desk_wbox_head_status")
    if (!live) {
        live = document.createElement("span")
        live.className = "desk_wbox_head_status visually_hidden"
        live.setAttribute("role", "status")
        item.el.querySelector(".desk_wbox_head")?.append(live)
    }
    live.textContent = message
}

export async function save_window(item: desk_window): Promise<void> {
    const commit = item.commit
    if (!commit || item.problem !== "") return
    const root = document_of(item), original = root.file, save = root.save, mime = root.mime
    if (pending.has(root)) return
    pending.add(root)
    sync_save(item)
    const bytes = latest_bytes(root)
    try {
        const blob = await commit()
        if (!blob || root.file !== original) return
        const file = new Blob([blob], { type: mime })
        if (save) await save(file)
        else {
            const current = () => root.file === original && root.el.isConnected
            const target = await pick_destination(root.name, current)
            if (!target || !current()) return
            const write = await write_destination(target, file)
            if (!current()) return
            root.save = write; root.path = `file://${target.path}`; root.name = target.name
            root.el.dataset.path = root.path
            sync_navigation(root); refresh_tab(root)
            await refresh_dir(target.directory)
        }
        if (root.file !== original) return
        accept_save(root, file, bytes)
        item.dirty = is_dirty(item)
        announce(item, text("text_saved"))
    } catch {
        announce(item, text("files_failed"))
    } finally { pending.delete(root); sync_save(item) }
}
