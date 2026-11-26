import type { desk_window } from "../index.ts"
import { state, text } from "../index.ts"
import { mime_matches, is_mime } from "../mime/detect.ts"
import { flow_kind_of, forget_edits } from "../plugin/flow.ts"
import { head_part } from "../window/head.ts"
import { render_window, process_hooks } from "../window/index.ts"

export function mime_icon(mime: string): string {
    return state.data?.mimes.find(info => info.mime === mime)?.icon ?? state.data?.file_icon ?? ""
}

// ---- the type list ------------------------------------------------------------------------------------------------------------

export function list_button(icon: string, label: string, current: boolean, attrs: Record<string, string>): HTMLLIElement {
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
    if (item.parent) item.picks.mime = true
    if (flow_kind_of(item) === "convert") {
        process_hooks.release(item); item.pid = null; item.error = ""
        item.file = null; item.path = item.name = ""; item.save = null
        forget_edits(item)
    }
    item.mime = mime
    item.icon = mime_icon(mime)
    render_window(item)
}

export function set_mode(item: desk_window, mode: string): void {
    if (item.mode === mode) return
    if (item.parent) item.picks.mode = true
    item.mode = mode
    render_window(item)
}
