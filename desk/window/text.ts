import { token_map, coloured_nodes } from "./text/syntax.ts"
import type { desk_window } from "../index.ts"
import { text } from "../index.ts"
import { flow_kind_of, latest_bytes, announce_edit, subscribe_edits, is_dirty } from "../plugin/flow.ts"
import { comparison_lines } from "../plugin/compare.ts"
import { unknown_body, renders } from "./index.ts"
import { sync_save } from "../action/save.ts"

// One shared line/byte layout for Code and Hex. The byte buffer remains authoritative
// until text is explicitly changed, including when UTF-8 decoding is lossy.
export function text_layout_body(item: desk_window, hex_mode = !(item.mime.startsWith("text/") || /(?:json|xml|javascript|typescript|x-sh|x-yaml|sql)$/.test(item.mime))): HTMLElement {
    const file = item.file!
    if (file.size > edit_limit) return too_large(item)
    const editable = item.mode === "edit"
    const signal = renders.get(item)!.signal
    const comparing = flow_kind_of(item) === "compare" && item.parent?.mime.startsWith("text/") && item.mime.startsWith("text/") && !!item.parent.file && item.parent.file.size <= edit_limit
    let source_text: string | null = null
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
        holder.classList.toggle("is_coloured", map !== null || !!comparing)
        if (comparing && source_text !== null) {
            const changes = comparison_lines(source_text, value)
            layer.replaceChildren(...value.split("\n").map((value, index) => {
                const row = document.createElement("span")
                row.className = "desk_diff_line"
                if (changes.added.has(index)) row.classList.add("desk_diff_added")
                const removed = changes.removed.get(index)
                if (removed) { row.classList.add("desk_diff_removed"); row.dataset.removed = String(removed); row.title = `${removed} removed line(s)` }
                row.textContent = value + "\n"
                return row
            }))
            box.dataset.comparison = changes.limited ? "limited" : "ready"
        } else
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
        announce_edit(item, bytes)
    })
    bytes_input.addEventListener("input", () => {
        const parsed = parse_hex(bytes_input.value)
        valid(parsed.bad ? `${text("hex_invalid")} ${parsed.bad}` : "")
        if (parsed.bad) return
        bytes = new Uint8Array(parsed.bytes)
        area.value = new TextDecoder().decode(bytes)
        draw()
        announce_edit(item, bytes)
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
        bytes = new Uint8Array(latest_bytes(item) ?? buffer)
        area.value = new TextDecoder().decode(bytes)
        bytes_input.value = hex_lines(bytes)
        area.disabled = bytes_input.disabled = false
        ready = true
        box.dataset.ready = "true"
        draw()
        sync_save(item)
    }).catch(() => valid(text("files_failed")))
    const receive = (next: Uint8Array): void => {
        item.dirty = is_dirty(item)
        sync_save(item)
        if (!ready || signal.aborted || bytes === next) return
        const selection = [area.selectionStart, area.selectionEnd] as const
        const scroll = [box.scrollTop, box.scrollLeft]
        bytes = new Uint8Array(next)
        const value = new TextDecoder().decode(bytes)
        if (area.value !== value) { area.value = value; area.setSelectionRange(...selection) }
        bytes_input.value = hex_lines(bytes)
        draw()
        box.scrollTop = scroll[0]; box.scrollLeft = scroll[1]
    }
    signal.addEventListener("abort", subscribe_edits(item, receive), { once: true })
    if (comparing && item.parent?.file) {
        const parent = item.parent
        void parent.file!.text().then(value => {
            if (signal.aborted) return
            source_text = latest_bytes(parent) ? new TextDecoder().decode(latest_bytes(parent)!) : value
            if (ready) draw()
        })
        signal.addEventListener("abort", subscribe_edits(parent, bytes => {
            source_text = new TextDecoder().decode(bytes)
            if (ready) draw()
        }), { once: true })
    }
    const viewport = editable
        ? edit_shell(item, box, async () => ready && !item.problem ? new Blob([new Uint8Array(bytes)], { type: item.mime }) : null)
        : document.createElement("div")
    viewport.classList.add("desk_wbox_body_editor")
    if (!editable) viewport.append(box)
    return viewport
}

// ---- editors ------------------------------------------------------------------------------------------------------------------
// Editor factories report valid data to the shared Save control.

export const edit_limit = 2_000_000

export function edit_shell(item: desk_window, editor: HTMLElement, commit: () => Promise<Blob | null>): HTMLElement {
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

export function too_large(item: desk_window): HTMLElement {
    const note = unknown_body(item)
    note.firstElementChild!.textContent = text("edit_too_large")
    return note
}

// Bytes as hex, 16 to a line, with the offsets and the characters beside them. Edit the hex; anything that is not a byte is reported and
// the save is held back.
export function parse_hex(value: string): { bytes: Uint8Array, bad: string } {
    const tokens = value.split(/\s+/).filter(token => token.length > 0)
    const bytes = new Uint8Array(tokens.length)
    for (let index = 0; index < tokens.length; index++) {
        if (!/^[0-9a-fA-F]{1,2}$/.test(tokens[index])) return { bytes, bad: tokens[index] }
        bytes[index] = parseInt(tokens[index], 16)
    }
    return { bytes, bad: "" }
}

export function hex_lines(bytes: Uint8Array): string {
    const rows: string[] = []
    for (let at = 0; at < bytes.length; at += 16) rows.push([...bytes.slice(at, at + 16)].map(byte => byte.toString(16).padStart(2, "0")).join(" "))
    return rows.join("\n")
}

export function printable(bytes: Uint8Array): string {
    const rows: string[] = []
    for (let at = 0; at < bytes.length; at += 16) rows.push([...bytes.slice(at, at + 16)].map(byte => (byte >= 32 && byte < 127 ? String.fromCharCode(byte) : ".")).join(""))
    return rows.join("\n")
}
