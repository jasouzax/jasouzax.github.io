// What a desk window holds and shows: a file arrives (dropped, uploaded or opened from the file tree), the window learns its name and type and
// shows it in its mode. The window itself (tabs, layout) is client_desk.ts.

import { token_map, coloured_nodes } from "./desk_syntax.ts"
import type { desk_window } from "./desk.ts"
import { state, text, refresh_tab, window_hooks } from "./desk.ts"
import { detect_mimes, mime_matches, is_mime } from "./desk_mime.ts"
import { prepare_plugins } from "./desk_plugins.ts"
import { media_player } from "./desk_media.ts"
import { markdown_body } from "./desk_markdown.ts"

export function head_part<element extends HTMLElement>(item: desk_window, selector: string): element | null {
    return item.el.querySelector<element>(`.desk_wbox_head ${selector}`)
}

function mime_icon(mime: string): string {
    return state.data?.mimes.find(info => info.mime === mime)?.icon ?? state.data?.file_icon ?? ""
}

// every child of the window except its head is the body
export function set_body(item: desk_window, body: Node): void {
    for (const child of [...item.el.children]) if (!child.matches(".desk_wbox_head")) child.remove()
    item.el.append(body)
}

function size_label(size: number): string {
    return size < 1024 ? `${size} ${text("bytes")}` : size < 1048576 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1048576).toFixed(1)} MB`
}

// The view for a file nothing above can show: what it is (name, type, size) and a way to get it back out.
function unknown_body(item: desk_window): HTMLElement {
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

// ---- the type list ------------------------------------------------------------------------------------------------------------

function list_button(icon: string, label: string, current: boolean, attrs: Record<string, string>): HTMLLIElement {
    const row = document.createElement("li")
    row.className = "list_drop_li"
    const button = document.createElement("button")
    button.type = "button"
    for (const [key, value] of Object.entries(attrs)) button.setAttribute(key, value)
    if (current) button.setAttribute("aria-current", "true")
    if (icon) {
        const mark = document.createElement("span")
        mark.className = "list_drop_icon"
        mark.setAttribute("aria-hidden", "true")
        mark.textContent = icon
        button.append(mark)
    }
    button.append(label)
    row.append(button)
    return row
}

// With nothing typed the list is what the detector found (the likeliest one first and picked). Typing searches every known type; a type
// that is not known can still be used by typing it in full (type/subtype) and pressing Enter.
export function fill_mime_list(item: desk_window, query: string = ""): void {
    const list = head_part(item, ".desk_wbox_head_mime > .list_drop")
    if (!list) return
    for (const row of [...list.children]) if (!row.matches(".list_drop_search")) row.remove()
    const known = state.data?.mimes ?? []
    const rows: HTMLElement[] = []
    if (query.trim() === "") {
        item.candidates.forEach((mime, index) => {
            const info = known.find(entry => entry.mime === mime)
            rows.push(list_button(info?.icon ?? state.data?.file_icon ?? "", index === 0 ? `${mime} (${text("guess_mime").toLowerCase()})` : mime, mime === item.mime, { "data-mime": mime }))
        })
        if (item.mime && !item.candidates.includes(item.mime)) rows.unshift(list_button(state.data?.file_icon ?? "", item.mime, true, { "data-mime": item.mime }))
    } else {
        for (const info of mime_matches(query)) rows.push(list_button(info.icon, info.mime, info.mime === item.mime, { "data-mime": info.mime }))
        const typed = query.trim().toLowerCase()
        if (rows.length === 0 && is_mime(typed)) rows.push(list_button(state.data?.file_icon ?? "", `${text("use_mime")} ${typed}`, false, { "data-mime": typed }))
        if (rows.length === 0) {
            const none = document.createElement("li")
            none.className = "list_drop_none"
            none.textContent = text("no_mime_match")
            rows.push(none)
        }
    }
    list.append(...rows)
}

export function set_mime(item: desk_window, mime: string): void {
    item.mime = mime
    item.icon = mime_icon(mime)
    render_window(item)
}

export function set_mode(item: desk_window, mode: string): void {
    if (item.mode === mode) return
    item.mode = mode
    render_window(item)
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
    return media_player(item, url_of(item), () => fail_window(item, item.path || item.name, text("files_open_failed")))
}

// One shared line/byte layout for Code and Hex. The byte buffer remains authoritative
// until text is explicitly changed, including when UTF-8 decoding is lossy.
function text_layout_body(item: desk_window, hex_mode = false): HTMLElement {
    const file = item.file!
    if (file.size > edit_limit) return too_large(item)
    const editable = item.mode === "edit"
    const box = document.createElement("div")
    box.className = "desk_wbox_body_text"
    const part = (tag: string, name: string): HTMLElement => {
        const node = document.createElement(tag)
        node.className = `desk_wbox_body_text_${name}`
        return node
    }
    const line = part("div", "line")
    const dec = part("pre", "line_dec")
    const hex = part("pre", "line_hex")
    const toggle = document.createElement("details")
    toggle.className = "desk_wbox_body_text_tog"
    toggle.open = hex_mode
    const summary = document.createElement("summary")
    summary.title = "Hex / Text"
    summary.setAttribute("aria-label", "Hex / Text")
    const chevron = document.createElement("span")
    chevron.textContent = "›"
    summary.append(chevron)
    toggle.append(summary)
    line.append(dec, hex, toggle)
    const byte_column = part("div", "byte")
    const split = part("pre", "body desk_wbox_body_text_body_split")
    const plain = part("div", "body desk_wbox_body_text_body_plain")
    const holder = part("div", "edit")
    const layer = part("pre", "colour")
    const area = document.createElement("textarea")
    area.className = "desk_wbox_body_text_input"
    area.spellcheck = false
    area.wrap = "off"
    area.readOnly = !editable
    area.disabled = true
    area.setAttribute("aria-label", item.name)
    const bytes_input = document.createElement("textarea")
    bytes_input.className = "desk_wbox_body_text_hex_input"
    bytes_input.spellcheck = false
    bytes_input.wrap = "off"
    bytes_input.readOnly = !editable
    bytes_input.disabled = true
    bytes_input.setAttribute("aria-label", `Hex: ${item.name}`)
    byte_column.append(bytes_input)
    holder.append(layer, area)
    plain.append(holder)
    box.append(line, byte_column, split, plain)
    let bytes = new Uint8Array()
    let ready = false
    const draw = (): void => {
        const value = area.value
        const map = token_map(value, item.mime)
        holder.classList.toggle("is_coloured", map !== null)
        layer.replaceChildren(...(map ? coloured_nodes(value, map, 0, value.length, false) : [document.createTextNode(value)]), document.createTextNode("\n"))
        dec.textContent = value.split("\n").map((_, index) => index + 1).join("\n")
        const count = Math.max(1, Math.ceil(bytes.length / 16))
        hex.textContent = Array.from({ length: count }, (_, index) => (index * 16).toString(16).padStart(6, "0").toUpperCase()).join("\n")
        split.textContent = printable(bytes)
        bytes_input.rows = count
        bytes_input.cols = 48
        bytes_input.style.height = `${count * 1.5}em`
    }
    const valid = (message: string): void => {
        item.problem = message
        bytes_input.setAttribute("aria-invalid", String(!!message))
        sync_save(item)
    }
    area.addEventListener("input", () => {
        bytes = new TextEncoder().encode(area.value)
        bytes_input.value = hex_lines(bytes)
        valid("")
        draw()
    })
    bytes_input.addEventListener("input", () => {
        const parsed = parse_hex(bytes_input.value)
        valid(parsed.bad ? `${text("hex_invalid")} ${parsed.bad}` : "")
        if (parsed.bad) return
        bytes = new Uint8Array(parsed.bytes)
        area.value = new TextDecoder().decode(bytes)
        draw()
    })
    toggle.addEventListener("toggle", () => {
        if (item.problem) { toggle.open = true; return }
        if (ready) draw()
    })
    area.addEventListener("keydown", event => {
        if (event.key === "Tab" && !event.shiftKey && editable) {
            event.preventDefault()
            area.setRangeText("\t", area.selectionStart, area.selectionEnd, "end")
            area.dispatchEvent(new Event("input", { bubbles: true }))
        }
    })
    void file.arrayBuffer().then(buffer => {
        if (!box.isConnected) return
        bytes = new Uint8Array(buffer)
        area.value = new TextDecoder().decode(bytes)
        bytes_input.value = hex_lines(bytes)
        area.disabled = bytes_input.disabled = false
        ready = true
        box.dataset.ready = "true"
        draw()
        sync_save(item)
    }).catch(() => valid(text("files_failed")))
    if (!editable) return box
    return edit_shell(item, box, async () => ready && !item.problem ? new Blob([new Uint8Array(bytes)], { type: item.mime }) : null)
}

// ---- editors ------------------------------------------------------------------------------------------------------------------
// Editor factories report valid data to the shared Save control.

const edit_limit = 2_000_000

function edit_shell(item: desk_window, editor: HTMLElement, commit: () => Promise<Blob | null>): HTMLElement {
    const box = document.createElement("div")
    box.className = "desk_wbox_body_edit"
    // the save button is in the window's head: the editor only says what there is to save
    item.commit = commit
    box.append(editor)
    box.addEventListener("desk:invalid", event => {
        item.problem = (event as CustomEvent<string>).detail
        sync_save(item)
    })
    sync_save(item)
    return box
}

// ---- save (the button in the head) ---------------------------------------------------------------------------------------------
// The button is enabled while the window has an editor with something valid to save, and is marked while the editor holds a change that
// has not been saved. Saving writes to the file system when the file lives there; a file only held by the window is kept in the window.

export function sync_save(item: desk_window): void {
    const button = head_part<HTMLButtonElement>(item, ".desk_wbox_head_save")
    if (!button) return
    const ready = item.commit !== null && item.problem === ""
    button.disabled = !ready
    button.classList.toggle("is_dirty", item.commit !== null && item.dirty)
    button.title = item.problem !== "" ? item.problem : item.dirty && item.commit ? text("unsaved") : text("save")
    button.setAttribute("aria-label", button.title)
}

function announce(item: desk_window, message: string): void {
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
    try {
        const blob = await commit()
        if (!blob) return
        item.file = new Blob([blob], { type: item.mime })
        await item.save?.(item.file)
        item.dirty = false
        // a file that only lives in this window has no place to be written to: it is kept in the window, and the message says so
        announce(item, text(item.save ? "text_saved" : "text_kept"))
    } catch {
        announce(item, text("files_failed"))
    }
    sync_save(item)
}

function too_large(item: desk_window): HTMLElement {
    const note = unknown_body(item)
    note.firstElementChild!.textContent = text("edit_too_large")
    return note
}

// Bytes as hex, 16 to a line, with the offsets and the characters beside them. Edit the hex; anything that is not a byte is reported and
// the save is held back.
function parse_hex(value: string): { bytes: Uint8Array, bad: string } {
    const tokens = value.split(/\s+/).filter(token => token.length > 0)
    const bytes = new Uint8Array(tokens.length)
    for (let index = 0; index < tokens.length; index++) {
        if (!/^[0-9a-fA-F]{1,2}$/.test(tokens[index])) return { bytes, bad: tokens[index] }
        bytes[index] = parseInt(tokens[index], 16)
    }
    return { bytes, bad: "" }
}

function hex_lines(bytes: Uint8Array): string {
    const rows: string[] = []
    for (let at = 0; at < bytes.length; at += 16) rows.push([...bytes.slice(at, at + 16)].map(byte => byte.toString(16).padStart(2, "0")).join(" "))
    return rows.join("\n")
}

function printable(bytes: Uint8Array): string {
    const rows: string[] = []
    for (let at = 0; at < bytes.length; at += 16) rows.push([...bytes.slice(at, at + 16)].map(byte => (byte >= 32 && byte < 127 ? String.fromCharCode(byte) : ".")).join(""))
    return rows.join("\n")
}

// Process rendering is installed by desk_proc; plugin scripts choose when to use it.
export const process_hooks = {
    body: (_item: desk_window): HTMLElement | null => null,
    release: (_item: desk_window): void => {},
    release_body: (_item: desk_window): void => {},
}
export const uri_handlers: ((item: desk_window, uri: string) => Promise<boolean>)[] = []
const renders = new WeakMap<desk_window, AbortController>()

function fallback_body(item: desk_window): HTMLElement {
    if (item.error) {
        const note = unknown_body(item)
        note.classList.add("desk_wbox_body_error")
        note.firstElementChild!.textContent = item.error
        return note
    }
    if (!item.file && !item.path && item.pid === null) {
        const label = document.createElement("label")
        label.className = "desk_wbox_body_empty"
        const message = document.createElement("span")
        message.className = "desk_wbox_body_empty_text"
        message.textContent = text("drop_file_or_upload")
        const input = document.createElement("input")
        input.className = "desk_wbox_body_empty_input"
        input.type = "file"
        input.multiple = true
        input.setAttribute("aria-label", text("choose_file"))
        label.append(message, input)
        return label
    }
    const note = unknown_body(item)
    note.firstElementChild!.textContent = `${text(`unsupported_${item.mode}`)} ${item.mime}`
    return note
}

export function fail_window(item: desk_window, path: string, message: string): void {
    process_hooks.release(item)
    item.path = path
    item.name = path.split("/").pop() || path
    item.file = null
    item.save = null
    item.error = message
    render_window(item)
}

const loads = new WeakMap<desk_window, number>()
export async function open_source(item: desk_window, uri: string): Promise<void> {
    const revision = (loads.get(item) ?? 0) + 1
    loads.set(item, revision)
    renders.get(item)?.abort()
    item.error = ""
    if (!uri.trim()) {
        process_hooks.release(item)
        item.file = null
        item.path = item.name = ""
        render_window(item)
        return
    }
    try {
        for (const handler of uri_handlers) if (await handler(item, uri)) return
        const path = uri.replace(/^file:\/\//, "")
        const url = new URL(path, location.href)
        if (!["https:", "http:", "blob:", "data:"].includes(url.protocol)) throw new Error("Unsupported URI")
        const response = await fetch(url)
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
        const file = await response.blob()
        if (loads.get(item) !== revision || !item.el.isConnected) return
        await load_file(item, file, path.split("/").pop() || path, uri)
    } catch (error) {
        if (loads.get(item) === revision) fail_window(item, uri, `${text("files_open_failed")}: ${String(error)}`)
    }
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
    const host = { code: text_layout_body, media: media_body, terminal: process_hooks.body, fallback: fallback_body, markdown: markdown_body, state, text, render_window, save_window }
    set_body(item, fallback_body(item))
    void prepare_plugins(item, host, controller.signal).then(candidates => {
        if (controller.signal.aborted || !item.el.isConnected) return
        for (const { context, module } of candidates) {
            try {
                const body = module.render?.(context)
                if (body) {
                    set_body(item, body)
                    item.el.dataset.plugin = context.plugin.id
                }
                const cleanup = module.setup?.(context)
                if (cleanup) controller.signal.addEventListener("abort", cleanup, { once: true })
                if (body) { sync_save(item); return }
            } catch (error) {
                console.warn(`Plugin ${context.plugin.id} failed`, error)
            }
        }
    }).catch(error => {
        if (!controller.signal.aborted) {
            item.error = String(error)
            set_body(item, fallback_body(item))
        }
    })
}

export function render_window(item: desk_window): void {
    refresh_tab(item)
    const path = head_part<HTMLInputElement>(item, ".desk_wbox_head_path")
    if (path) path.value = item.path || item.name
    const summary = head_part(item, ".desk_wbox_head_mime > summary")
    if (summary) summary.textContent = item.mime || text("no_mime")
    for (const button of item.el.querySelectorAll<HTMLElement>(".desk_wbox_head_mode button[data-mode]")) {
        const active = button.dataset.mode === item.mode
        button.setAttribute("aria-checked", String(active))
        button.tabIndex = active ? 0 : -1
    }
    fill_mime_list(item)
    // a new body starts with nothing to save; an editor claims the save button when it is made
    item.commit = null
    item.dirty = false
    item.problem = ""
    body_for(item)
    sync_save(item)
}

export async function load_file(item: desk_window, file: Blob, name: string, path: string = ""): Promise<void> {
    process_hooks.release(item)
    item.error = ""
    item.pid = null
    item.file = file
    item.name = name
    item.path = path
    item.save = null
    item.candidates = await detect_mimes(file, name)
    item.mime = item.candidates[0] ?? ""
    item.icon = mime_icon(item.mime)
    item.mode = "view"
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
    // a source typed in the head and confirmed with Enter is opened: pid: starts a process, pid:3 shows one
    head_part<HTMLInputElement>(item, ".desk_wbox_head_path")?.addEventListener("keydown", event => {
        if (event.key !== "Enter") return
        event.preventDefault()
        const value = (event.target as HTMLInputElement).value
        void open_source(item, value)
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
        if (search && search.value !== "") {
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
    let depth = 0
    box.addEventListener("dragenter", event => {
        if (!has_files(event)) return
        event.preventDefault()
        depth++
        box.classList.add("is_drop")
    })
    box.addEventListener("dragover", event => {
        if (!has_files(event)) return
        event.preventDefault()
        if (event.dataTransfer) event.dataTransfer.dropEffect = "copy"
    })
    box.addEventListener("dragleave", event => {
        if (!has_files(event)) return
        depth = Math.max(0, depth - 1)
        if (depth === 0) box.classList.remove("is_drop")
    })
    box.addEventListener("drop", event => {
        if (!has_files(event)) return
        event.preventDefault()
        depth = 0
        box.classList.remove("is_drop")
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
    window_hooks.closed = item => {
        renders.get(item)?.abort()
        item.el.querySelectorAll<HTMLMediaElement>("video, audio").forEach(media => media.pause())
        release_url(item)
    }
    window_hooks.created = item => {
        wire(item, open_window)
        wire_head(item)
        fill_mime_list(item)
        render_window(item)
    }
}
