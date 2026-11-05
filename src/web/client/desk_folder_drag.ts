import type { desk_window } from "./desk.ts"
import { text } from "./desk.ts"
import { can_create, can_move, can_read } from "./desk_fs_permissions.ts"
import { can_drop_entries, desk_drag_type, dragged_entries, end_entry_drag, move_folder_entries, start_entry_drag, type fs_node } from "./desk_fs.ts"
import { capture_imports, import_entries } from "./desk_folder_drop.ts"
import { resolve } from "./desk_vfs.ts"

export function bind_folder_drag(item: desk_window, body: HTMLElement, status: HTMLElement, directory: () => fs_node | null, entry_at: (target: Element) => fs_node | null, signal: AbortSignal): void {
    const clear = () => {
        body.removeAttribute("data-drop")
        for (const tile of body.querySelectorAll(".desk_folder_tile[data-drop]")) tile.removeAttribute("data-drop")
    }
    const destination = (event: DragEvent): fs_node | null => {
        const node = entry_at(event.target as Element)
        return node?.kind === "dir" ? node : directory()
    }
    const internal = (data: DataTransfer) => data.types.includes(desk_drag_type)
    const start = (event: DragEvent) => {
        const node = entry_at(event.target as Element)
        if (!node || !event.dataTransfer) return
        if (!can_move(node) || !can_read(node)) { event.preventDefault(); return }
        start_entry_drag([node], event.dataTransfer)
    }
    const over = (event: DragEvent) => {
        const data = event.dataTransfer
        if (!data || (!internal(data) && !data.types.includes("Files"))) return
        event.stopPropagation(); event.preventDefault(); clear()
        const dir = destination(event)
        const sources = dragged_entries()
        if (!dir || !can_create(dir) || (internal(data) && sources.length && !can_drop_entries(dir, sources))) { data.dropEffect = "none"; return }
        data.dropEffect = internal(data) ? "move" : "copy"
        const node = entry_at(event.target as Element)
        if (node?.kind === "dir") (event.target as Element).closest(".desk_folder_entry")?.querySelector(".desk_folder_tile")?.setAttribute("data-drop", "")
        else body.setAttribute("data-drop", "")
    }
    const leave = (event: DragEvent) => { if (!item.el.contains(event.relatedTarget as Node | null)) clear() }
    const drop = (event: DragEvent) => {
        const data = event.dataTransfer
        if (!data || (!internal(data) && !data.types.includes("Files"))) return
        event.preventDefault(); event.stopPropagation(); clear()
        const dir = destination(event)
        if (!dir) return
        const paths = internal(data) ? data.getData(desk_drag_type) : null
        const imports = paths === null ? capture_imports(data) : null
        void (async () => {
            const current = await resolve(dir.path)
            if (!current || signal.aborted) return
            if (paths !== null) {
                const sources: unknown = JSON.parse(paths)
                if (!Array.isArray(sources) || !sources.every(path => typeof path === "string" && path.startsWith("/"))) throw new Error(text("files_unsupported"))
                await move_folder_entries(current, sources)
            } else await import_entries(current, await imports!)
        })().catch(error => { if (!signal.aborted) status.textContent = error instanceof Error ? error.message : text("files_failed") })
    }
    const end = () => { clear(); end_entry_drag() }
    item.el.addEventListener("dragstart", start)
    item.el.addEventListener("dragenter", over); item.el.addEventListener("dragover", over)
    item.el.addEventListener("dragleave", leave); item.el.addEventListener("drop", drop); item.el.addEventListener("dragend", end)
    signal.addEventListener("abort", () => {
        clear(); item.el.removeEventListener("dragstart", start)
        item.el.removeEventListener("dragenter", over); item.el.removeEventListener("dragover", over)
        item.el.removeEventListener("dragleave", leave); item.el.removeEventListener("drop", drop); item.el.removeEventListener("dragend", end)
    }, { once: true })
}
