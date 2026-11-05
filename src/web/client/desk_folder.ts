import type { desk_window } from "./desk.ts"
import { state, text } from "./desk.ts"
import { load_children, redraw, type fs_node, type file_handle } from "./desk_fs.ts"
import { resolve } from "./desk_vfs.ts"
import { open_source } from "./desk_view.ts"
import { can_browse, can_read, check_permissions } from "./desk_fs_permissions.ts"
import { file_preview, preview_key, text_preview_node, card_preview_node, type preview_result } from "./desk_previews.ts"
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

type tile_state = {
    node: fs_node, row: HTMLLIElement, tile: HTMLButtonElement, frame: HTMLElement, icon: HTMLElement,
    name: HTMLElement, signature: string, generation: number, started: boolean, urls: Set<string>,
}

export function folder_body(item: desk_window, signal: AbortSignal): HTMLElement {
    const body = document.createElement("div"); body.className = "desk_wbox_body_folder"
    const status = document.createElement("p"); status.className = "desk_folder_status"; status.setAttribute("role", "status")
    const grid = document.createElement("ul"); grid.className = "desk_folder_grid"; grid.setAttribute("aria-label", text("folder_contents"))
    body.append(status, grid)
    const tiles = new Map<string, tile_state>()
    const queued = new Set<tile_state>()
    const queue: tile_state[] = []
    let active = 0, revision = 0, directory: fs_node | null = null
    let close_context = () => {}
    const path_of = () => local_file_path(item.path) ?? "/"
    const revoke = (urls: Set<string>) => { for (const url of urls) URL.revokeObjectURL(url); urls.clear() }
    const dispose = (entry: tile_state) => { entry.generation++; observer.unobserve(entry.tile); revoke(entry.urls); entry.row.remove() }
    const preview_element = async (preview: preview_result, mime: string, urls: Set<string>): Promise<HTMLElement> => {
        if (preview.text !== undefined) return text_preview_node(preview.text, mime)
        if (preview.card) return card_preview_node(preview.card)
        const image = document.createElement("img"); image.alt = ""; image.decoding = "async"
        const url = URL.createObjectURL(preview.blob); urls.add(url); image.src = url
        await image.decode()
        return image
    }
    const draw = async (entry: tile_state): Promise<void> => {
        const generation = entry.generation
        const live = () => !signal.aborted && tiles.get(entry.node.path) === entry && generation === entry.generation
        const urls = new Set<string>()
        try {
            const node = entry.node
            await check_permissions([node])
            const readable = node.kind === "dir" ? can_browse(node) : can_read(node)
            if (!live()) return
            entry.tile.disabled = !readable
            entry.tile.draggable = readable
            if (!readable) {
                entry.signature = ""; entry.icon.hidden = false
                entry.frame.replaceChildren(entry.icon); entry.tile.classList.remove("has_cover"); revoke(entry.urls)
                return
            }
            if (node.kind === "dir") {
                await load_children(node)
                const plan = folder_cover_plan(node.children ?? [])
                const files: { node: fs_node, file: File, mime: string, key: string }[] = []
                for (const child of plan.files) {
                    await check_permissions([child])
                    if (!can_read(child) || !child.handle) continue
                    const file = await (child.handle as file_handle).getFile(), mime = mime_of(child, file)
                    files.push({ node: child, file, mime, key: await preview_key(child.path, file, mime) })
                }
                if (!live()) return
                const signature = JSON.stringify([plan.nested, plan.count, files.map(file => [file.node.path, file.key])])
                if (signature === entry.signature) return
                const cover = document.createElement("span"); cover.className = "desk_folder_cover"
                // Keep unchanged pieces of a folder's mosaic, including their object URLs.
                const retained_urls = new Set<string>()
                const pieces: HTMLElement[] = []
                for (const file of files) {
                    const old = [...entry.frame.querySelectorAll<HTMLElement>(".desk_folder_cover > [data-key]")].find(piece => piece.dataset.key === file.key)
                    if (old) { pieces.push(old); if (old instanceof HTMLImageElement) retained_urls.add(old.src); continue }
                    try {
                        const preview = await file_preview(file.node.path, file.file, file.mime)
                        const piece = await preview_element(preview, file.mime, urls)
                        piece.dataset.key = file.key; pieces.push(piece)
                    } catch { /* one unavailable preview does not hide the folder */ }
                }
                if (!live()) return
                cover.append(...pieces); cover.dataset.count = String(pieces.length)
                for (const url of retained_urls) entry.urls.delete(url)
                revoke(entry.urls)
                for (const url of retained_urls) entry.urls.add(url)
                for (const url of urls) entry.urls.add(url)
                urls.clear()
                entry.icon.dataset.double = String(plan.nested)
                entry.tile.dataset.coverFiles = JSON.stringify(plan.files.map(node => node.path))
                entry.tile.dataset.coverCount = String(plan.count)
                entry.frame.replaceChildren(...(pieces.length ? [cover, entry.icon] : [entry.icon]))
                entry.tile.classList.toggle("has_cover", pieces.length > 0)
                if (plan.count > 4) { const more = document.createElement("span"); more.className = "desk_folder_more"; more.textContent = `+${plan.count - 4}`; entry.frame.append(more) }
                entry.signature = signature; entry.tile.dataset.preview = "cover"
            } else if (node.handle) {
                const file = await (node.handle as file_handle).getFile(), mime = mime_of(node, file)
                const signature = await preview_key(node.path, file, mime)
                if (!live() || signature === entry.signature) return
                const preview = await file_preview(node.path, file, mime)
                const piece = await preview_element(preview, mime, urls)
                if (!live()) return
                revoke(entry.urls); for (const url of urls) entry.urls.add(url); urls.clear()
                entry.icon.hidden = true; entry.frame.replaceChildren(entry.icon, piece)
                entry.signature = signature; entry.tile.dataset.preview = preview.source
            }
        } catch { if (live() && !entry.signature) entry.tile.dataset.preview = "unavailable" }
        finally { revoke(urls) }
    }
    const pump = () => {
        while (!signal.aborted && active < 2 && queue.length) {
            const entry = queue.shift()!; queued.delete(entry)
            if (tiles.get(entry.node.path) !== entry) continue
            active++
            void draw(entry).finally(() => { active--; pump() })
        }
    }
    const schedule = (entry: tile_state) => {
        entry.generation++; entry.started = true; observer.unobserve(entry.tile)
        if (!queued.has(entry)) { queued.add(entry); queue.push(entry) }
        pump()
    }
    const observer = new IntersectionObserver(entries => {
        for (const visible of entries) if (visible.isIntersecting) {
            const entry = tiles.get((visible.target as HTMLElement).dataset.path ?? "")
            if (entry) schedule(entry)
        }
    }, { root: grid, rootMargin: "160px" })
    const create = (node: fs_node): tile_state => {
        const row = document.createElement("li"); row.className = "desk_folder_entry"; row.dataset.path = node.path
        const tile = document.createElement("button"); tile.type = "button"; tile.className = "desk_folder_tile"; tile.dataset.path = node.path; tile.dataset.kind = node.kind
        const frame = document.createElement("span"); frame.className = "desk_folder_preview"
        const icon = document.createElement("span"); icon.className = "desk_folder_glyph"; icon.setAttribute("aria-hidden", "true"); icon.textContent = icon_of(node)
        if (node.kind === "dir") icon.dataset.icon = icon_of(node)
        const name = document.createElement("span"); name.className = "desk_folder_name"
        frame.append(icon); tile.append(frame, name); row.append(tile)
        const entry: tile_state = { node, row, tile, frame, icon, name, signature: "", generation: 0, started: false, urls: new Set() }
        tile.addEventListener("click", event => { if (event.detail <= 1) void open_source(item, `file://${entry.node.path}`) })
        return entry
    }
    const refresh = async () => {
        const current = ++revision
        try {
            const dir = await resolve(path_of())
            if (!dir || dir.kind !== "dir") throw new Error(text("folder_not_found"))
            await load_children(dir); await check_permissions([dir])
            if (signal.aborted || current !== revision) return
            if (!can_browse(dir)) throw new Error(text("files_denied"))
            directory = dir; redraw()
            const children = dir.children ?? [], paths = new Set(children.map(node => node.path))
            for (const [path, entry] of tiles) if (!paths.has(path)) { dispose(entry); tiles.delete(path) }
            let cursor = grid.firstElementChild
            for (const node of children) {
                let entry = tiles.get(node.path)
                if (entry && entry.node.kind !== node.kind) { if (cursor === entry.row) cursor = entry.row.nextElementSibling; dispose(entry); tiles.delete(node.path); entry = undefined }
                if (!entry) { entry = create(node); tiles.set(node.path, entry) }
                entry.node = node
                if (entry.name.textContent !== node.name) entry.name.textContent = node.name
                entry.tile.title = node.name
                entry.tile.disabled = node.kind === "dir" ? !can_browse(node) : !can_read(node)
                entry.tile.draggable = !entry.tile.disabled
                if (entry.row !== cursor) grid.insertBefore(entry.row, cursor)
                cursor = entry.row.nextElementSibling
                if (entry.started) schedule(entry)
                else observer.observe(entry.tile)
            }
            status.textContent = children.length ? `${children.length} ${text("folder_items")}` : text("files_empty")
        } catch (error) {
            if (!signal.aborted && current === revision) {
                status.textContent = error instanceof Error ? error.message : text("files_failed")
                for (const entry of tiles.values()) dispose(entry)
                tiles.clear()
            }
        }
    }
    status.textContent = text("folder_loading")
    const entry_at = (target: Element) => tiles.get(target.closest<HTMLElement>(".desk_folder_entry")?.dataset.path ?? "")?.node ?? null
    close_context = bind_folder_context(item, body, status, signal)
    bind_folder_drag(item, body, status, () => directory, entry_at, signal)
    let timer: ReturnType<typeof setTimeout> | undefined
    const changed = (event: Event) => {
        const path = (event as CustomEvent<{ path: string }>).detail.path
        const kind = folder_change(path_of(), path)
        if (kind === "contents") { clearTimeout(timer); timer = setTimeout(() => void refresh(), 80) }
        else if (kind === "cover") { const entry = tiles.get(path); if (entry) schedule(entry) }
    }
    document.addEventListener("jazu:fs:changed", changed)
    signal.addEventListener("abort", () => {
        revision++; close_context(); observer.disconnect(); clearTimeout(timer); queue.length = 0; queued.clear()
        for (const entry of tiles.values()) dispose(entry)
        tiles.clear(); document.removeEventListener("jazu:fs:changed", changed)
    }, { once: true })
    void refresh()
    return body
}
