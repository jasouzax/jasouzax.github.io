import type { desk_window } from "./desk.ts"
import { state, text } from "./desk.ts"
import { load_children, open_entry, redraw, type fs_node, type file_handle } from "./desk_fs.ts"
import { resolve } from "./desk_vfs.ts"
import { open_source } from "./desk_view.ts"
import { can_browse, can_move, can_read, check_permissions } from "./desk_fs_permissions.ts"
import { file_preview, text_preview_node } from "./desk_previews.ts"
import { local_file_path } from "./desk_paths.ts"
import { folder_change, folder_cover_plan } from "./desk_folder_cover.ts"
import { bind_folder_context } from "./desk_folder_context.ts"
import { bind_folder_drag } from "./desk_folder_drag.ts"

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
    const status = document.createElement("p")
    status.className = "desk_folder_status"; status.setAttribute("role", "status")
    const grid = document.createElement("ul")
    grid.className = "desk_folder_grid"
    grid.setAttribute("aria-label", text("folder_contents"))
    body.append(status, grid)
    const urls = new Set<string>()
    const entries = new Map<string, fs_node>()
    const cover_refreshers = new Map<string, () => void>()
    let directory: fs_node | null = null
    let close_context = () => {}
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
        close_context(); observer?.disconnect(); queue = []; release(); entries.clear(); cover_refreshers.clear()
        grid.replaceChildren()
        status.textContent = text("folder_loading")
        const path = path_of()
        try {
            const dir = await resolve(path)
            if (!dir || dir.kind !== "dir") throw new Error(text("folder_not_found"))
            await load_children(dir)
            await check_permissions([dir])
            if (signal.aborted || revision !== current) return
            if (dir.readable === false || dir.content_readable === false) throw new Error(text("files_denied"))
            directory = dir
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
                row.className = "desk_folder_entry"; row.dataset.path = child.path
                entries.set(child.path, child)
                const tile = document.createElement("button")
                tile.type = "button"; tile.className = "desk_folder_tile"
                tile.dataset.path = child.path; tile.dataset.kind = child.kind
                tile.title = child.name; tile.disabled = child.kind === "dir" ? !can_browse(child) : !can_read(child)
                tile.draggable = can_move(child) && can_read(child)
                const frame = document.createElement("span")
                frame.className = "desk_folder_preview"
                const icon = document.createElement("span")
                icon.className = "desk_folder_glyph"; icon.setAttribute("aria-hidden", "true"); icon.textContent = icon_of(child)
                if (child.kind === "dir") icon.dataset.icon = icon_of(child)
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
                if (child.kind === "dir" && !tile.disabled) {
                    let cover_revision = 0
                    const old_urls = new Set<string>()
                    const revoke = (values: Set<string>) => { for (const url of values) { URL.revokeObjectURL(url); urls.delete(url) }; values.clear() }
                    const job = () => {
                        const cover_current = ++cover_revision
                        const live = () => !signal.aborted && revision === current && cover_current === cover_revision
                        return async () => {
                            if (!live()) return
                            const latest = await resolve(child.path)
                            if (!latest || latest.kind !== "dir") return
                            await check_permissions([latest])
                            if (!can_browse(latest)) { if (live()) tile.disabled = true; return }
                            await load_children(latest)
                            if (!live()) return
                            const plan = folder_cover_plan(latest.children ?? [])
                            icon.dataset.double = String(plan.nested)
                            tile.dataset.coverFiles = JSON.stringify(plan.files.map(node => node.path))
                            tile.dataset.coverCount = String(plan.count)
                            const cover = document.createElement("span")
                            cover.className = "desk_folder_cover"
                            const next_urls = new Set<string>()
                            for (const node of plan.files) {
                                if (!live()) break
                                try {
                                    await check_permissions([node])
                                    if (!can_read(node) || !node.handle) continue
                                    const file = await (node.handle as file_handle).getFile()
                                    const preview = await file_preview(node.path, file, mime_of(node, file))
                                    if (!live()) break
                                    if (preview.text !== undefined) { cover.append(text_preview_node(preview.text, mime_of(node, file))); continue }
                                    const url = URL.createObjectURL(preview.blob)
                                    next_urls.add(url); urls.add(url)
                                    const picture = document.createElement("img")
                                    picture.alt = ""; picture.src = url
                                    await picture.decode()
                                    cover.append(picture)
                                } catch { /* an unreadable direct file does not hide the folder */ }
                            }
                            if (!live()) { revoke(next_urls); return }
                            frame.querySelector(".desk_folder_cover")?.remove()
                            frame.querySelector(".desk_folder_more")?.remove()
                            revoke(old_urls)
                            for (const url of next_urls) old_urls.add(url)
                            tile.classList.toggle("has_cover", cover.childElementCount > 0)
                            cover.dataset.count = String(cover.childElementCount)
                            if (cover.childElementCount) frame.insertBefore(cover, icon)
                            if (plan.count > 4) {
                                const more = document.createElement("span"); more.className = "desk_folder_more"; more.textContent = `+${plan.count - 4}`
                                frame.append(more)
                            }
                            tile.dataset.preview = "cover"
                        }
                    }
                    tasks.set(tile, job())
                    cover_refreshers.set(child.path, () => {
                        observer?.unobserve(tile); tasks.delete(tile)
                        queue.push(job()); pump()
                    })
                    observer.observe(tile)
                    continue
                }
                if (child.kind !== "file" || !child.handle || tile.disabled) continue
                tasks.set(tile, async () => {
                    try {
                        if (signal.aborted || revision !== current) return
                        await check_permissions([child])
                        if (!can_read(child)) { tile.disabled = true; return }
                        const file = await (child.handle as file_handle).getFile()
                        const result = await file_preview(child.path, file, mime_of(child, file))
                        if (signal.aborted || revision !== current) return
                        if (result.text !== undefined) {
                            frame.append(text_preview_node(result.text, mime_of(child, file)))
                            icon.hidden = true; tile.dataset.preview = result.source
                            return
                        }
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
    const entry_at = (target: Element) => entries.get(target.closest<HTMLElement>(".desk_folder_entry")?.dataset.path ?? "") ?? null
    close_context = bind_folder_context(item, body, status, signal)
    bind_folder_drag(item, body, status, () => directory, entry_at, signal)
    let timer: ReturnType<typeof setTimeout> | undefined
    const changed = (event: Event) => {
        const path = (event as CustomEvent<{ path: string }>).detail.path
        const current = path_of()
        const kind = folder_change(current, path)
        if (kind === "contents") {
            clearTimeout(timer); timer = setTimeout(() => void refresh(), 80)
        } else if (kind === "cover") cover_refreshers.get(path)?.()
    }
    document.addEventListener("jazu:fs:changed", changed)
    signal.addEventListener("abort", () => {
        revision++; queue = []; observer?.disconnect(); release(); clearTimeout(timer)
        document.removeEventListener("jazu:fs:changed", changed)
    }, { once: true })
    void refresh()
    return body
}
