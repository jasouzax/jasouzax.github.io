import { conversion_body } from "../conversion/body.ts"
import { text_layout_body } from "./text.ts"
import { sync_save, save_window } from "../action/save.ts"
export { sync_save, save_window } from "../action/save.ts"
import { mime_icon, fill_mime_list, set_mime, set_mode } from "../action/resource.ts"
export { fill_mime_list, set_mime, set_mode } from "../action/resource.ts"
import { head_part } from "./head.ts"
export { head_part } from "./head.ts"
// What a desk window holds and shows: a file arrives (dropped, uploaded or opened from the file tree), the window learns its name and type and
// shows it in its mode. The window itself (tabs, layout) is client_desk.ts.

import { is_server_page } from "../server/text.ts"

import type { desk_window } from "../index.ts"
import { state, text, refresh_tab, window_hooks, focus_window, working_directory } from "../index.ts"
import { detect_mimes } from "../mime/detect.ts"
import { prepare_plugins } from "../plugin/loader.ts"
import { media_body as media_window_body } from "./media.ts"
import { markdown_body, notebook_body } from "./note.ts"
import { folder_body } from "./folder.ts"
import { bind_navigation, sync_navigation } from "../action/history.ts"
import { desk_drag_type } from "../fs/opfs.ts"
import { link_hooks, refresh_children, flow_kind_of, document_of, forget_edits, is_dirty } from "../plugin/flow.ts"
import { html_body, image_pdf_body } from "./preview.ts"

import { no_picks } from "../plugin/rules.ts"
import { message_body } from "./messages.ts"
import { auto_script_body } from "../server/script.ts"
import { auto_site_body } from "../server/site.ts"
import { bind_window_controls, dispose_window_controls } from "../action/controls.ts"
import { register_map_resources } from "../menu/map.ts"

// every child of the window except its head is the body
export function set_body(item: desk_window, body: Node): void {
    for (const child of [...item.el.children]) if (!child.matches(".desk_wbox_head")) child.remove()
    item.el.append(body)
}

function size_label(size: number): string {
    return size < 1024 ? `${size} ${text("bytes")}` : size < 1048576 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1048576).toFixed(1)} MB`
}

// The view for a file nothing above can show: what it is (name, type, size) and a way to get it back out.
export function unknown_body(item: desk_window): HTMLElement {
    const note = document.createElement("div")
    note.className = "desk_wbox_body_none"
    note.setAttribute("role", "status")
    const line = document.createElement("p")
    line.textContent = text("unknown_file")
    note.append(line)
    if (item.file) {
        const facts = document.createElement("p")
        facts.className = "desk_wbox_body_none_facts"
        facts.textContent = [item.name, item.mime || text("no_mime"), size_label(item.file.size)].join(" \u00b7 ")
        const save = document.createElement("a")
        save.className = "desk_wbox_body_none_save"
        save.textContent = text("save_download")
        save.download = item.name
        save.href = url_of(item)
        note.append(facts, save)
    }
    return note
}

// ---- viewers ------------------------------------------------------------------------------------------------------------------
// One function per kind of body. A window's body is picked by its type and mode (body_for); a type with no viewer gets the unknown note.

const object_urls = new WeakMap<desk_window, string>()

function release_url(item: desk_window): void {
    const url = object_urls.get(item)
    if (url) URL.revokeObjectURL(url)
    object_urls.delete(item)
}

function url_of(item: desk_window): string {
    release_url(item)
    const url = URL.createObjectURL(item.file!)
    object_urls.set(item, url)
    return url
}

// image, video and audio: the browser's own player over the file, which stays in this tab (a blob: address, nothing is uploaded)
function media_body(item: desk_window): HTMLElement {
    return media_window_body(item, url_of(item), renders.get(item)!.signal, () => fail_window(item, item.path || item.name, text("files_open_failed")))
}

// Process rendering is installed by desk_proc; plugin scripts choose when to use it.
export const process_hooks = {
    body: (_item: desk_window): HTMLElement | null => null,
    release: (_item: desk_window): void => {},
    release_body: (_item: desk_window): void => {},
}
// /server always selects the Pi PTY; the ordinary desk can prefer the device bridge.
let local_terminal_uri = "pid:"
export const terminal_hooks = {
    get uri(): string { return is_server_page(location.pathname) ? "server:sh" : local_terminal_uri },
    set uri(value: string) { local_terminal_uri = value },
}

export const uri_handlers: ((item: desk_window, uri: string, current?: () => boolean) => Promise<boolean>)[] = []
export const renders = new WeakMap<desk_window, AbortController>()

function fallback_body(item: desk_window): HTMLElement {
    if (flow_kind_of(item) === "convert" && !item.file) {
        const note = document.createElement("div")
        note.className = "desk_wbox_body_none"
        note.setAttribute("role", "status")
        note.textContent = text("conversion_unavailable").replace("{from}", item.parent!.mime).replace("{to}", item.mime)
        return note
    }
    if (item.error) {
        const note = unknown_body(item)
        note.classList.add("desk_wbox_body_error")
        note.firstElementChild!.textContent = item.error
        return note
    }
    if (!item.file && !item.path && item.pid === null) {
        const empty = document.createElement("div")
        empty.className = "desk_wbox_body_empty"
        const label = document.createElement("label")
        label.className = "desk_wbox_body_empty_upload"
        const message = document.createElement("span")
        message.className = "desk_wbox_body_empty_text"
        message.textContent = text("drop_file_or_upload")
        const input = document.createElement("input")
        input.className = "desk_wbox_body_empty_input"
        input.type = "file"
        input.multiple = true
        input.setAttribute("aria-label", text("choose_file"))
        label.append(message, input)
        const actions = document.createElement("div")
        actions.className = "desk_wbox_body_empty_actions"
        const folder = document.createElement("button")
        folder.type = "button"
        folder.className = "desk_wbox_body_empty_folder"
        folder.textContent = text("open_folder")
        folder.title = working_directory()
        const terminal = document.createElement("button")
        terminal.type = "button"
        terminal.className = "desk_wbox_body_empty_terminal"
        terminal.textContent = text("open_terminal")
        // a split child holds the parent's resource or a resource of its own: it is never a terminal
        actions.append(folder)
        if (!item.parent) actions.append(terminal)
        empty.append(actions, label)
        return empty
    }
    const note = unknown_body(item)
    note.firstElementChild!.textContent = item.mime === "inode/directory" && item.mode === "view"
        ? text("folder_loading") : `${text(`unsupported_${item.mode}`)} ${item.mime}`
    return note
}

export function fail_window(item: desk_window, path: string, message: string): void {
    process_hooks.release(item)
    item.path = path
    item.name = path.split("/").pop() || path
    forget_edits(item)
    item.file = null
    item.save = null
    item.error = message
    render_window(item)
}

const loads = new WeakMap<desk_window, number>()
export async function open_source(item: desk_window, uri: string): Promise<void> {
    const revision = (loads.get(item) ?? 0) + 1
    loads.set(item, revision)
    const current = () => loads.get(item) === revision && item.el.isConnected
    renders.get(item)?.abort()
    item.error = ""
    if (!uri.trim()) {
        forget_edits(item)
        process_hooks.release(item)
        item.file = null
        item.path = item.name = ""
        item.mime = item.icon = ""; item.candidates = []; item.save = null
        // an emptied child is back to everything off
        item.mode = item.parent ? "" : "view"
        if (item.parent) item.picks = no_picks()
        render_window(item)
        return
    }
    if (item.parent) item.picks.own = true
    try {
        if (/^im:(?:[^\s@]+@[^\s@]+|guest\/[1-9]\d*)$/i.test(uri)) {
            process_hooks.release(item)
            forget_edits(item)
            item.file = null; item.save = null; item.pid = null
            item.path = uri; item.name = uri.slice(3); item.mode = "view"
            item.mime = "message/cpim"; item.candidates = [item.mime]; item.icon = mime_icon(item.mime)
            render_window(item)
            return
        }
        for (const handler of uri_handlers) {
            if (!current()) return
            if (await handler(item, uri, current)) return
        }
        const path = uri.replace(/^file:\/\//, "")
        const url = new URL(path, location.href)
        if (!["https:", "http:", "blob:", "data:"].includes(url.protocol)) throw new Error("Unsupported URI")
        const response = await fetch(url)
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
        const file = await response.blob()
        if (loads.get(item) !== revision || !item.el.isConnected) return
        await load_file(item, file, path.split("/").pop() || path, uri, current)
    } catch (error) {
        if (loads.get(item) === revision) fail_window(item, uri, `${text("files_open_failed")}: ${String(error)}`)
    }
}

// the log view of an automation script; without the owner's link it is the plain (read-only) code
function script_body(item: desk_window, signal: AbortSignal): HTMLElement {
    return auto_script_body(item, signal, () => text_layout_body(item))
}

// the live feed of a site or of a window of the Pi; a .auto.site file without the owner's link is its text, any other source says why it is empty
function site_body(item: desk_window, signal: AbortSignal): HTMLElement {
    return auto_site_body(item, signal, () => {
        if (item.file) return text_layout_body(item)
        const note = document.createElement("div")
        note.className = "server_site_note"
        note.textContent = text("server_offline")
        return note
    })
}

function mirror_body(item: desk_window, signal: AbortSignal): HTMLElement {
    const body = document.createElement("div")
    body.className = "desk_mirror_body"
    const host = { html: html_body, image_pdf: image_pdf_body, mirror: mirror_body, editor: text_layout_body,
        media: media_body, terminal: process_hooks.body, fallback: fallback_body, markdown: markdown_body, notebook: notebook_body, folder: folder_body,
        messages: message_body, auto_script: script_body, auto_site: site_body, state, text, render_window, save_window, register_map_resources }
    void prepare_plugins(item, host, signal, true).then(candidates => {
        if (signal.aborted) return
        for (const { context, module } of candidates) {
            const rendered = module.render?.(context)
            const cleanup = module.setup?.(context)
            if (cleanup) signal.addEventListener("abort", cleanup, { once: true })
            if (rendered) { body.replaceChildren(rendered); sync_save(item); return }
        }
        body.replaceChildren(fallback_body(item))
    }).catch(error => { if (!signal.aborted) body.textContent = String(error) })
    return body
}

function body_for(item: desk_window): void {
    renders.get(item)?.abort()
    process_hooks.release_body(item)
    const previous_media = item.el.querySelector<HTMLMediaElement>("video, audio")
    if (previous_media) { previous_media.pause(); previous_media.removeAttribute("src"); previous_media.load() }
    delete item.el.dataset.plugin
    release_url(item)
    const controller = new AbortController()
    renders.set(item, controller)
    const converting = flow_kind_of(item) === "convert"
    if (converting) {
        const pending = conversion_body(item, controller.signal)
        if (pending) { set_body(item, pending); sync_save(item); return }
        item.commit = async () => item.file
    }
    const is_folder = () => !item.error && item.mime === "inode/directory" && item.mode === "view"
    const fallback = (target: desk_window) => !target.error && target.mime === "inode/directory" && target.mode === "view"
        ? folder_body(target, controller.signal) : fallback_body(target)
    const show_fallback = () => {
        set_body(item, fallback(item))
        item.el.dataset.plugin = is_folder() ? "folder" : "default"
        sync_save(item)
    }
    // Site View/Edit are live browser surfaces even for file-less split mirrors.
    // Do not let a stale plugin catalog send this resource to a file editor.
    if (!item.error && item.mime === "application/auto-site" && ["view", "edit"].includes(item.mode)
        && (!flow_kind_of(item) || flow_kind_of(item) === "mirror")) {
        set_body(item, site_body(item, controller.signal))
        item.el.dataset.plugin = "auto_site"
        sync_save(item)
        return
    }
    const host = { html: html_body, image_pdf: image_pdf_body, mirror: mirror_body, editor: text_layout_body, media: media_body, terminal: process_hooks.body, fallback, markdown: markdown_body, notebook: notebook_body, folder: folder_body, messages: message_body, auto_script: script_body, auto_site: site_body, state, text, render_window, save_window, register_map_resources }
    set_body(item, fallback_body(item))
    void prepare_plugins(item, host, controller.signal, converting).then(candidates => {
        if (controller.signal.aborted || !item.el.isConnected) return
        for (const { context, module } of candidates) {
            try {
                const body = module.render?.(context)
                if (body) {
                    set_body(item, body)
                    item.el.dataset.plugin = body.classList.contains("desk_wbox_body_folder") ? "folder" : context.plugin.id
                }
                const cleanup = module.setup?.(context)
                if (cleanup) controller.signal.addEventListener("abort", cleanup, { once: true })
                if (body) { sync_save(item); return }
            } catch (error) {
                console.warn(`Plugin ${context.plugin.id} failed`, error)
            }
        }
        if (!controller.signal.aborted && item.el.isConnected) show_fallback()
    }).catch(error => {
        if (!controller.signal.aborted) {
            if (is_folder()) { show_fallback(); return }
            item.error = String(error)
            set_body(item, fallback_body(item))
        }
    })
}

export function render_window(item: desk_window): void {
    if (item.parent && flow_kind_of(item) === "mirror") {
        const source = document_of(item)
        for (const key of ["file", "name", "path", "mime", "icon", "candidates", "save", "pid", "error"] as const) {
            Object.assign(item, { [key]: source[key] })
        }
    }
    refresh_tab(item)
    sync_navigation(item)
    const summary = head_part(item, ".desk_wbox_head_mime > summary")
    if (summary) summary.textContent = item.mime || text("no_mime")
    // with no mode picked (an empty child) neither radio is on; the first stays reachable by keyboard
    const no_mode = item.mode !== "view" && item.mode !== "edit"
    for (const [index, button] of item.el.querySelectorAll<HTMLElement>(".desk_wbox_head_mode button[data-mode]").entries()) {
        const active = button.dataset.mode === item.mode
        button.setAttribute("aria-checked", String(active))
        button.tabIndex = active || (no_mode && index === 0) ? 0 : -1
    }
    fill_mime_list(item)
    // a new body starts with nothing to save; an editor claims the save button when it is made
    item.commit = null
    item.dirty = is_dirty(item)
    item.problem = ""
    body_for(item)
    sync_save(item)
    item.el.dispatchEvent(new Event("jazu:window-state"))
    // the children hold this window's resource: they draw themselves again
    refresh_children(item)
}

export async function load_file(item: desk_window, file: Blob, name: string, path: string = "", current = () => true): Promise<void> {
    if (!current()) return
    if (item.parent) item.picks.own = true
    forget_edits(item)
    item.dirty = false
    process_hooks.release(item)
    item.error = ""
    item.pid = null
    item.file = file
    item.name = name
    item.path = path
    item.save = null
    const candidates = await detect_mimes(file, name)
    if (!current()) return
    item.candidates = candidates
    item.mime = item.candidates[0] ?? ""
    item.icon = mime_icon(item.mime)
    item.mode = /^(text\/|application\/(?:.*json|.*xml|javascript|typescript|x-sh|x-yaml|sql)$)/.test(item.mime) ? "edit" : "view"
    render_window(item)
}

export function load_folder(item: desk_window, path: string, name: string): void {
    if (item.parent) item.picks.own = true
    forget_edits(item)
    item.dirty = false
    process_hooks.release(item)
    item.error = ""; item.pid = null; item.file = null; item.save = null
    item.path = path; item.name = name; item.mode = "view"
    item.mime = "inode/directory"; item.candidates = [item.mime]
    item.icon = state.data?.folder_icon ?? ""
    item.el.dataset.path = path; item.el.dataset.mime = item.mime
    render_window(item)
}

// the lists' clicks, the search and Enter
function wire_head(item: desk_window): void {
    item.el.addEventListener("keydown", event => {
        const target = (event.target as Element).closest<HTMLElement>(".desk_wbox_head_mode button[data-mode]")
        if (!target || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return
        event.preventDefault()
        const buttons = [...item.el.querySelectorAll<HTMLButtonElement>(".desk_wbox_head_mode button[data-mode]")]
        const next = event.key === "Home" ? buttons[0] : event.key === "End" ? buttons[buttons.length - 1] : buttons.find(button => button !== target)
        if (next) { set_mode(item, next.dataset.mode ?? "view"); next.focus() }
    })
    item.el.addEventListener("click", event => {
        const target = event.target as HTMLElement
        if (target.closest(".desk_wbox_head_save")) {
            void save_window(item)
            return
        }
        const pick = target.closest<HTMLElement>(".desk_wbox_head_mime button[data-mime]")
        const mode = target.closest<HTMLElement>(".desk_wbox_head_mode button[data-mode]")
        if (pick) {
            set_mime(item, pick.dataset.mime ?? "")
            pick.closest("details")?.removeAttribute("open")
        } else if (mode) {
            set_mode(item, mode.dataset.mode ?? "view")
        }
    })
    // typing in the editor marks the change; Ctrl+S in the window saves it
    item.el.addEventListener("input", event => {
        if (!item.commit || (event.target as Element).closest(".desk_wbox_head")) return
        if (!item.dirty) {
            item.dirty = true
            sync_save(item)
        }
    })
    item.el.addEventListener("keydown", event => {
        if (!item.commit || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return
        event.preventDefault()
        void save_window(item)
    })
    bind_navigation(item, uri => open_source(item, uri), () => {
        if (item.pid !== null || !item.path) render_window(item)
        else void open_source(item, item.path)
    })
    const search = head_part<HTMLInputElement>(item, ".desk_wbox_head_mime .list_drop_search input")
    search?.addEventListener("input", () => fill_mime_list(item, search.value))
    search?.addEventListener("keydown", event => {
        if (event.key !== "Enter") return
        event.preventDefault()
        const first = item.el.querySelector<HTMLElement>(".desk_wbox_head_mime button[data-mime]")
        if (first?.dataset.mime) {
            set_mime(item, first.dataset.mime)
            search.value = ""
            search.closest("details")?.removeAttribute("open")
        }
    })
    // closing the list forgets the search
    head_part<HTMLDetailsElement>(item, ".desk_wbox_head_mime")?.addEventListener("toggle", () => {
        if (!head_part<HTMLDetailsElement>(item, ".desk_wbox_head_mime")?.open && search && search.value !== "") {
            search.value = ""
            fill_mime_list(item)
        }
    })
}

// ---- drop and upload ----------------------------------------------------------------------------------------------------------------

function has_files(event: DragEvent): boolean {
    return [...(event.dataTransfer?.types ?? [])].includes("Files")
}

// the first file fills this window, any others each open a window of their own
// Every upload is kept in /tmp (the file system fills this in), so the window's source reads file:///tmp/name.
export const upload_hooks = {
    store: async (_file: File): Promise<string | null> => null,
}

function take_files(item: desk_window, files: File[], open_window: () => desk_window | null): void {
    files.forEach((file, index) => {
        const target = index === 0 ? item : open_window()
        if (!target) return
        void upload_hooks.store(file).then(path => path ? open_source(target, `file://${path}`) : load_file(target, file, file.name))
    })
}

function wire(item: desk_window, open_window: () => desk_window | null): void {
    const box = item.el
    box.addEventListener("click", event => {
        if ((event.target as Element).closest(".desk_wbox_body_empty_folder")) void open_source(item, `file://${working_directory()}`)
        if ((event.target as Element).closest(".desk_wbox_body_empty_terminal")) void open_source(item, terminal_hooks.uri)
    })
    let depth = 0
    box.addEventListener("dragenter", event => {
        if (item.mime === "inode/directory") return
        if (!has_files(event) && !event.dataTransfer?.types.includes(desk_drag_type)) return
        event.preventDefault()
        depth++
        box.classList.add("is_drop")
    })
    box.addEventListener("dragover", event => {
        if (item.mime === "inode/directory") return
        if (!has_files(event) && !event.dataTransfer?.types.includes(desk_drag_type)) return
        event.preventDefault()
        if (event.dataTransfer) event.dataTransfer.dropEffect = "copy"
    })
    box.addEventListener("dragleave", event => {
        if (item.mime === "inode/directory") return
        if (!has_files(event) && !event.dataTransfer?.types.includes(desk_drag_type)) return
        depth = Math.max(0, depth - 1)
        if (depth === 0) box.classList.remove("is_drop")
    })
    box.addEventListener("drop", event => {
        if (item.mime === "inode/directory") return
        if (!has_files(event) && !event.dataTransfer?.types.includes(desk_drag_type)) return
        event.preventDefault()
        depth = 0
        box.classList.remove("is_drop")
        if (event.dataTransfer?.types.includes(desk_drag_type)) {
            try {
                const paths: unknown = JSON.parse(event.dataTransfer.getData(desk_drag_type))
                if (!Array.isArray(paths) || !paths.every(path => typeof path === "string" && path.startsWith("/"))) return
                paths.forEach((path, index) => {
                    const target = index === 0 ? item : open_window()
                    if (target) { if (index === 0) focus_window(target); void open_source(target, `file://${path}`) }
                })
            } catch { /* ignore malformed drag payloads */ }
            return
        }
        take_files(item, [...(event.dataTransfer?.files ?? [])], open_window)
    })
    box.addEventListener("change", event => {
        const input = event.target as HTMLInputElement
        if (!input.matches(".desk_wbox_body_empty_input")) return
        take_files(item, [...(input.files ?? [])], open_window)
        input.value = ""
    })
}

export function init_view(open_window: () => desk_window | null): void {
    link_hooks.render = render_window
    window_hooks.closed = item => {
        dispose_window_controls(item)
        renders.get(item)?.abort()
        item.el.querySelectorAll<HTMLMediaElement>("video, audio").forEach(media => media.pause())
        release_url(item)
    }
    window_hooks.created = item => {
        wire(item, open_window)
        wire_head(item)
        bind_window_controls(item)
        fill_mime_list(item)
        render_window(item)
    }
}
