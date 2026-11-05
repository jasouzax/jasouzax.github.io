// What a desk window holds and shows: a file arrives (dropped, uploaded or opened from the file tree), the window learns its name and type and
// shows it in its mode. The window itself (tabs, layout) is client_desk.ts.

import { token_map, coloured_nodes } from "./desk_syntax.ts"
import type { desk_window } from "./desk.ts"
import { state, text, refresh_tab, window_hooks } from "./desk.ts"
import { detect_mimes, mime_matches, is_mime } from "./desk_mime.ts"

export function head_part<element extends HTMLElement>(item: desk_window, selector: string): element | null {
    return item.el.querySelector<element>(`.desk_wbox_head ${selector}`)
}

function mime_icon(mime: string): string {
    return state.data?.mimes.find(info => info.mime === mime)?.icon ?? state.data?.file_icon ?? ""
}

function extension_mime(name: string): string {
    const extension = name.split(".").pop()?.toLowerCase() ?? ""
    return state.data?.mimes.find(info => info.extensions.includes(extension))?.mime ?? ""
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
    const box = document.createElement("div")
    box.className = "desk_wbox_body_media desk_wbox_body_media_simple"
    const kind = item.mime.split("/")[0]
    const media = document.createElement(kind === "image" ? "img" : kind === "video" ? "video" : "audio")
    media.className = `desk_wbox_body_media_${kind}`
    media.src = url_of(item)
    if (media instanceof HTMLImageElement) media.alt = item.name
    else media.controls = true
    media.addEventListener("error", () => set_body(item, unknown_body(item)), { once: true })
    box.append(media)
    return box
}

function is_media(mime: string): boolean {
    return /^(image|video|audio)\//.test(mime)
}

export function is_text(mime: string): boolean {
    return mime.startsWith("text/") || /^application\/(json|typescript|javascript|xml|x-sh|x-yaml|x-httpd-php|sql)$/.test(mime) || /\+(xml|json)$/.test(mime)
}

// a text file is read once per render and never past this many bytes (a note says so)
const text_limit = 2_000_000

async function read_text(item: desk_window): Promise<{ value: string, cut: boolean }> {
    const file = item.file!
    return { value: await file.slice(0, text_limit).text(), cut: file.size > text_limit }
}

// Text view: the characters as they are, coloured by the window's mime type (client_desk_syntax.ts; a type with no language stays plain).
// They only ever go in through text nodes, so nothing in the file is parsed as HTML or run.
function text_body(item: desk_window): HTMLElement {
    const pre = document.createElement("pre")
    pre.className = "desk_wbox_body_text desk_wbox_body_text_raw"
    pre.tabIndex = 0
    void read_text(item).then(({ value, cut }) => {
        const map = token_map(value, item.mime)
        pre.replaceChildren(...(map ? coloured_nodes(value, map, 0, value.length, false) : [document.createTextNode(value)]), ...(cut ? [document.createTextNode("\n\u2026")] : []))
    }).catch(() => {
        pre.textContent = text("files_failed")
    })
    return pre
}

// Text mode: line numbers beside the text, with the bytes (hex) a toggle away; the same markup the static page uses. The text itself is
// editable in place: a see-through textarea sits over a coloured copy (as in the edit mode's code editor), the line numbers, the colours and
// (while the toggle is open) the bytes follow every keystroke, and Save (or Ctrl+S) writes the file back like the edit mode does.
function text_layout_body(item: desk_window): HTMLElement {
    const box = document.createElement("div")
    box.className = "desk_wbox_body_text"
    const editable = item.file!.size <= edit_limit
    const part = (tag: string, class_name: string): HTMLElement => {
        const element = document.createElement(tag)
        element.className = class_name
        return element
    }
    const dec = part("span", "desk_wbox_body_text_line_dec")
    const hex = part("span", "desk_wbox_body_text_line_hex")
    const line = part("div", "desk_wbox_body_text_line")
    const toggle = document.createElement("details")
    toggle.className = "desk_wbox_body_text_tog"
    const summary = document.createElement("summary")
    const arrow = document.createElement("span")
    arrow.setAttribute("aria-hidden", "true")
    arrow.textContent = "\uf054"
    summary.append(arrow)
    toggle.append(summary)
    line.append(dec, hex, toggle)
    const byte_column = part("div", "desk_wbox_body_text_byte")
    const split_body = part("div", "desk_wbox_body_text_body desk_wbox_body_text_body_split")
    const plain_body = part("div", "desk_wbox_body_text_body desk_wbox_body_text_body_plain")
    box.append(line, byte_column, split_body, plain_body)

    // the part of the view that depends on the text: line numbers and, when asked, the bytes (hex) with their split copy of the text
    const lined = (parts: string[], source: string, colours: Uint8Array | null, starts?: number[]): DocumentFragment => {
        const fragment = document.createDocumentFragment()
        parts.forEach((one, index) => {
            if (index > 0) fragment.append(document.createElement("br"))
            if (colours && starts) fragment.append(...coloured_nodes(source, colours, starts[index], starts[index] + one.length, true))
            else fragment.append(one.replace(/ /g, "\u00a0"))
        })
        return fragment
    }
    const draw_lines = (value: string): void => {
        const count = value.split("\n").length
        dec.replaceChildren(lined(Array.from({ length: count }, (_, index) => String(index + 1)), "", null))
    }
    const draw_bytes = (value: string, colours: Uint8Array | null): void => {
        const bytes = [...new TextEncoder().encode(value)]
        const rows: string[] = []
        for (let at = 0; at < bytes.length; at += 16) rows.push(bytes.slice(at, at + 16).map(byte => byte.toString(16).padStart(2, "0").toUpperCase()).join(" "))
        hex.replaceChildren(lined(rows.map((_, index) => `${(index + 1).toString(16).padStart(2, "0").toUpperCase()}X`), "", null))
        byte_column.replaceChildren(lined(rows, "", null))
        const marked = value.replace(/\n/g, "\ue001")
        const split = marked.match(/[\s\S]{1,16}/g) ?? []
        // the colours are those of the text itself (the line breaks are the same one unit, so the positions agree)
        split_body.replaceChildren(lined(split, marked, colours, split.map((_, row) => row * 16)))
    }
    const draw_static = (value: string, colours: Uint8Array | null): void => {
        const lines = value.split("\n")
        const starts: number[] = []
        lines.reduce((at, one) => {
            starts.push(at)
            return at + one.length + 1
        }, 0)
        plain_body.replaceChildren(lined(lines, value, colours, starts))
    }

    void read_text(item).then(({ value }) => {
        const colours = token_map(value, item.mime)
        draw_lines(value)
        draw_bytes(value, colours)
        if (!editable) return draw_static(value, colours)
        const area = document.createElement("textarea")
        area.className = "desk_wbox_body_text_input"
        area.spellcheck = false
        area.wrap = "off"
        area.value = value
        area.setAttribute("aria-label", item.name)
        const layer = document.createElement("pre")
        layer.className = "desk_wbox_body_text_colour"
        layer.setAttribute("aria-hidden", "true")
        const holder = part("div", "desk_wbox_body_text_edit")
        holder.append(layer, area)
        plain_body.replaceChildren(holder)
        let queued = 0
        const paint = (): void => {
            queued = 0
            const text_now = area.value
            const map = token_map(text_now, item.mime)
            holder.classList.toggle("is_coloured", map !== null)
            // the layer always holds the text: it is what gives the editor its height and width (the textarea is laid over it)
            layer.replaceChildren(...(map ? coloured_nodes(text_now, map, 0, text_now.length, false) : [document.createTextNode(text_now)]), document.createTextNode("\n"))
            draw_lines(text_now)
            if (toggle.open) draw_bytes(text_now, map)
        }
        // the bytes are only worked out while they show: opening the toggle brings them up to date
        toggle.addEventListener("toggle", () => {
            if (toggle.open) draw_bytes(area.value, token_map(area.value, item.mime))
        })
        area.addEventListener("input", () => {
            if (!queued) queued = requestAnimationFrame(paint)
        })
        // the box is what scrolls, so a caret that moves out of view moves the box
        const reveal = (): void => {
            const before = area.value.slice(0, area.selectionStart)
            const row = before.split("\n").length
            const height = parseFloat(getComputedStyle(area).lineHeight) || area.clientHeight / Math.max(1, area.value.split("\n").length)
            const top = (row - 1) * height
            const view = box.parentElement ?? box
            const room = view.clientHeight
            if (top < view.scrollTop) view.scrollTop = top
            else if (top + height > view.scrollTop + room - height * 2) view.scrollTop = top + height - room + height * 2
        }
        area.addEventListener("keyup", reveal)
        area.addEventListener("click", reveal)
        let tab_leaves = false
        area.addEventListener("keydown", event => {
            if (event.key === "Escape") tab_leaves = true
            else if (event.key === "Tab" && !event.shiftKey && !tab_leaves) {
                event.preventDefault()
                area.setRangeText("\t", area.selectionStart, area.selectionEnd, "end")
                area.dispatchEvent(new Event("input", { bubbles: true }))
            } else tab_leaves = false
        })
        paint()
        // the head's save button commits through here (edit_shell, below), so it reads the textarea
        box.dataset.ready = "true"
        commit = async () => new Blob([area.value], { type: item.mime })
    }).catch(() => {
        box.textContent = text("files_failed")
    })
    let commit: () => Promise<Blob | null> = async () => null
    if (!editable) return box
    return edit_shell(item, box, () => commit())
}

// ---- editors ------------------------------------------------------------------------------------------------------------------
// Edit mode picks an editor from a short list of selectors; the first that matches wins and the last is the byte editor, which takes anything.
// (Later entries, such as a picture or document editor, go in front of the text one.)

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

function text_editor(item: desk_window): HTMLElement {
    if (item.file!.size > edit_limit) return too_large(item)
    const area = document.createElement("textarea")
    area.className = "desk_wbox_body_edit_text"
    area.spellcheck = false
    area.wrap = "off"
    area.disabled = true
    // Code editor: a coloured copy of the text sits under the (see-through) textarea and follows its scrolling. The textarea stays the editor,
    // so typing, selection, undo and the caret are the browser's own. Without a language for the mime it is the plain textarea.
    const layer = document.createElement("pre")
    layer.className = "desk_wbox_body_edit_colour"
    layer.setAttribute("aria-hidden", "true")
    let coloured = false
    let queued = 0
    const paint = (): void => {
        queued = 0
        const map = token_map(area.value, item.mime)
        coloured = map !== null
        area.classList.toggle("is_coloured", coloured)
        // the extra line keeps the layer as tall as the textarea when the text ends in a line break
        layer.replaceChildren(...(map ? coloured_nodes(area.value, map, 0, area.value.length, false) : []), document.createTextNode("\n"))
        layer.scrollTop = area.scrollTop
        layer.scrollLeft = area.scrollLeft
    }
    area.addEventListener("input", () => {
        if (!queued) queued = requestAnimationFrame(paint)
    })
    area.addEventListener("scroll", () => {
        layer.scrollTop = area.scrollTop
        layer.scrollLeft = area.scrollLeft
    })
    // Tab types a tab instead of leaving the editor (Escape then Tab leaves it)
    let tab_leaves = false
    area.addEventListener("keydown", event => {
        if (event.key === "Escape") tab_leaves = true
        else if (event.key === "Tab" && !event.shiftKey && !tab_leaves) {
            event.preventDefault()
            area.setRangeText("\t", area.selectionStart, area.selectionEnd, "end")
            area.dispatchEvent(new Event("input", { bubbles: true }))
        } else tab_leaves = false
    })
    void item.file!.text().then(value => {
        area.value = value
        area.disabled = false
        paint()
    }).catch(() => {
        area.value = text("files_failed")
    })
    const holder = document.createElement("div")
    holder.className = "desk_wbox_body_edit_code"
    holder.append(layer, area)
    return edit_shell(item, holder, async () => new Blob([area.value], { type: item.mime }))
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

function byte_editor(item: desk_window): HTMLElement {
    if (item.file!.size > edit_limit / 4) return too_large(item)
    const grid = document.createElement("div")
    grid.className = "desk_wbox_body_edit_bytes"
    const offsets = document.createElement("pre")
    offsets.className = "desk_wbox_body_edit_offsets"
    offsets.setAttribute("aria-hidden", "true")
    const area = document.createElement("textarea")
    area.className = "desk_wbox_body_edit_hex"
    area.spellcheck = false
    area.wrap = "off"
    area.disabled = true
    const chars = document.createElement("pre")
    chars.className = "desk_wbox_body_edit_chars"
    chars.setAttribute("aria-hidden", "true")
    grid.append(offsets, area, chars)
    const refresh = (): { bytes: Uint8Array, bad: string } => {
        const parsed = parse_hex(area.value)
        const count = Math.max(1, Math.ceil(parsed.bytes.length / 16))
        offsets.textContent = Array.from({ length: count }, (_, row) => (row * 16).toString(16).padStart(6, "0")).join("\n")
        chars.textContent = printable(parsed.bytes)
        grid.dispatchEvent(new CustomEvent("desk:invalid", { bubbles: true, detail: parsed.bad ? `${text("hex_invalid")} ${parsed.bad}` : "" }))
        return parsed
    }
    area.addEventListener("input", refresh)
    void item.file!.arrayBuffer().then(buffer => {
        area.value = hex_lines(new Uint8Array(buffer))
        area.disabled = false
        refresh()
    }).catch(() => {
        area.value = ""
        grid.dispatchEvent(new CustomEvent("desk:invalid", { bubbles: true, detail: text("files_failed") }))
    })
    return edit_shell(item, grid, async () => {
        const parsed = refresh()
        return parsed.bad ? null : new Blob([parsed.bytes as BlobPart], { type: item.mime })
    })
}

// the editors by selector, first match wins
const editors: { matches: (mime: string) => boolean, make: (item: desk_window) => HTMLElement }[] = [
    { matches: mime => is_text(mime) || mime === "image/svg+xml", make: text_editor },
    { matches: () => true, make: byte_editor },
]

// the body for the window's type and mode
// what the window shows for a process (client_desk_proc.ts fills this in) and what typing a source in the head does
export const process_hooks = {
    body: (_item: desk_window): HTMLElement | null => null,
}

export const uri_handlers: ((item: desk_window, uri: string) => Promise<boolean>)[] = []

function body_for(item: desk_window): HTMLElement {
    if (item.pid !== null) return process_hooks.body(item) ?? unknown_body(item)
    if (!item.file) return unknown_body(item)
    if (item.mode === "view" && is_media(item.mime)) return media_body(item)
    if (item.mode === "view" && is_text(item.mime)) return text_body(item)
    if (item.mode === "text" && is_text(item.mime)) return text_layout_body(item)
    if (item.mode === "edit") return editors.find(editor => editor.matches(item.mime))!.make(item)
    return unknown_body(item)
}

export function render_window(item: desk_window): void {
    refresh_tab(item)
    const path = head_part<HTMLInputElement>(item, ".desk_wbox_head_path")
    if (path) path.value = item.path || item.name
    const summary = head_part(item, ".desk_wbox_head_mime > summary")
    if (summary) summary.textContent = item.mime || text("no_mime")
    const mode = head_part(item, ".desk_wbox_head_mode > summary")
    if (mode) mode.textContent = text(`mode_${item.mode}`)
    for (const button of item.el.querySelectorAll<HTMLElement>(".desk_wbox_head_mode button[data-mode]")) {
        if (button.dataset.mode === item.mode) button.setAttribute("aria-current", "true")
        else button.removeAttribute("aria-current")
    }
    fill_mime_list(item)
    // a new body starts with nothing to save; an editor claims the save button when it is made
    item.commit = null
    item.dirty = false
    item.problem = ""
    set_body(item, body_for(item))
    sync_save(item)
}

export async function load_file(item: desk_window, file: Blob, name: string, path: string = ""): Promise<void> {
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
            mode.closest("details")?.removeAttribute("open")
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
        void (async () => {
            for (const handler of uri_handlers) if (await handler(item, value)) return
        })()
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
        void upload_hooks.store(file).then(path => load_file(target, file, file.name, path ? `file://${path}` : ""))
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
    window_hooks.closed = release_url
    window_hooks.created = item => {
        wire(item, open_window)
        wire_head(item)
        fill_mime_list(item)
    }
}
