import type { desk_window } from "./desk.ts"
import { state, text } from "./desk.ts"
import { load_children, open_entry, redraw, type fs_node, type file_handle } from "./desk_fs.ts"
import { resolve } from "./desk_vfs.ts"
import { open_source } from "./desk_view.ts"
import { can_read, check_permissions } from "./desk_fs_permissions.ts"
import { file_preview } from "./desk_previews.ts"
import { local_file_path } from "./desk_paths.ts"

function mime_of(node: fs_node, file: File): string {
    const ext = node.name.split(".").pop()?.toLowerCase() ?? ""
    const named = state.data?.mimes.find(info => info.extensions.includes(ext))?.mime
    return file.type && file.type !== "application/octet-stream" && file.type !== "text/plain" ? file.type : named || file.type || "application/octet-stream"
}

function icon_of(node: fs_node): string {
    if (node.kind === "dir") return state.data?.folder_icon ?? ""
    const ext = node.name.split(".").pop()?.toLowerCase() ?? ""
    return state.data?.mimes.find(info => info.extensions.includes(ext))?.icon ?? state.data?.file_icon ?? ""
}

export function folder_body(item: desk_window, signal: AbortSignal): HTMLElement {
    const body = document.createElement("div")
    body.className = "desk_wbox_body_folder"
    const nav = document.createElement("nav")
    nav.className = "desk_folder_nav"
    nav.setAttribute("aria-label", text("folder_navigation"))
    const up = document.createElement("button")
    up.type = "button"; up.textContent = text("folder_up")
    const location = document.createElement("span")
    location.className = "desk_folder_location"
    const reload = document.createElement("button")
    reload.type = "button"; reload.textContent = text("folder_refresh")
    const status = document.createElement("p")
    status.className = "desk_folder_status"; status.setAttribute("role", "status")
    const grid = document.createElement("ul")
    grid.className = "desk_folder_grid"
    grid.setAttribute("aria-label", text("folder_contents"))
    nav.append(up, location, reload)
    body.append(nav, status, grid)
    const urls = new Set<string>()
    let revision = 0, active = 0
    let queue: (() => Promise<void>)[] = []
    let observer: IntersectionObserver | null = null
    const path_of = () => local_file_path(item.path) ?? "/"
    const release = () => { for (const url of urls) URL.revokeObjectURL(url); urls.clear() }
    const pump = () => {
        while (!signal.aborted && active < 2 && queue.length) {
            const task = queue.shift()!
            active++
            void task().catch(() => {}).finally(() => { active--; pump() })
        }
    }
    const refresh = async (): Promise<void> => {
        const current = ++revision
        observer?.disconnect(); queue = []; release()
        grid.replaceChildren()
        status.textContent = text("folder_loading")
        const path = path_of()
        location.textContent = path; location.title = path
        up.disabled = path === "/"
        try {
            const dir = await resolve(path)
            if (!dir || dir.kind !== "dir") throw new Error(text("folder_not_found"))
            await load_children(dir)
            await check_permissions([dir])
            if (signal.aborted || revision !== current) return
            if (dir.readable === false || dir.content_readable === false) throw new Error(text("files_denied"))
            redraw()
            const children = dir.children ?? []
            status.textContent = children.length ? `${children.length} ${text("folder_items")}` : text("files_empty")
            const tasks = new Map<Element, () => Promise<void>>()
            observer = new IntersectionObserver(entries => {
                for (const entry of entries) if (entry.isIntersecting) {
                    observer?.unobserve(entry.target)
                    const task = tasks.get(entry.target)
                    if (task) { tasks.delete(entry.target); queue.push(task) }
                }
                pump()
            }, { root: grid, rootMargin: "160px" })
            for (const child of children) {
                const row = document.createElement("li")
                const tile = document.createElement("button")
                tile.type = "button"; tile.className = "desk_folder_tile"
                tile.dataset.path = child.path; tile.dataset.kind = child.kind
                tile.title = child.name; tile.disabled = !can_read(child)
                const frame = document.createElement("span")
                frame.className = "desk_folder_preview"
                const icon = document.createElement("span")
                icon.className = "desk_folder_glyph"; icon.setAttribute("aria-hidden", "true"); icon.textContent = icon_of(child)
                const image = document.createElement("img")
                image.alt = ""; image.hidden = true; image.decoding = "async"
                frame.append(icon, image)
                const name = document.createElement("span")
                name.className = "desk_folder_name"; name.textContent = child.name
                tile.append(frame, name); row.append(tile); grid.append(row)
                tile.addEventListener("click", event => {
                    if (event.detail > 1) return
                    if (child.kind === "dir") void open_source(item, `file://${child.path}`)
                    else void open_entry(child, true)
                })
                if (child.kind !== "file" || !child.handle || tile.disabled) continue
                tasks.set(tile, async () => {
                    try {
                        if (signal.aborted || revision !== current) return
                        await check_permissions([child])
                        if (!can_read(child)) { tile.disabled = true; return }
                        const file = await (child.handle as file_handle).getFile()
                        const result = await file_preview(child.path, file, mime_of(child, file))
                        if (signal.aborted || revision !== current) return
                        const url = URL.createObjectURL(result.blob)
                        urls.add(url)
                        image.addEventListener("load", () => {
                            if (signal.aborted || revision !== current) return
                            image.hidden = false; icon.hidden = true
                            tile.dataset.preview = result.source
                        }, { once: true })
                        image.addEventListener("error", () => { image.hidden = true; icon.hidden = false }, { once: true })
                        image.src = url
                    } catch {
                        if (!signal.aborted && revision === current) tile.dataset.preview = "unavailable"
                    }
                })
                observer.observe(tile)
            }
        } catch (error) {
            if (!signal.aborted && revision === current) status.textContent = error instanceof Error ? error.message : text("files_failed")
        }
    }
    up.addEventListener("click", () => {
        const path = path_of()
        void open_source(item, `file://${path.slice(0, path.lastIndexOf("/")) || "/"}`)
    })
    reload.addEventListener("click", () => void refresh())
    let timer: ReturnType<typeof setTimeout> | undefined
    const changed = (event: Event) => {
        const path = (event as CustomEvent<{ path: string }>).detail.path
        const current = path_of()
        if (path === current || current.startsWith(`${path === "/" ? "" : path}/`)) {
            clearTimeout(timer); timer = setTimeout(() => void refresh(), 80)
        }
    }
    document.addEventListener("jazu:fs:changed", changed)
    signal.addEventListener("abort", () => {
        revision++; queue = []; observer?.disconnect(); release(); clearTimeout(timer)
        document.removeEventListener("jazu:fs:changed", changed)
    }, { once: true })
    void refresh()
    return body
}
