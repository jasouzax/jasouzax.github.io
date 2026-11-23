/** Live Windows navigation, split hierarchy and reversible hiding. Fixed desks never expose management. */
import { state, text, label_of, focus_window, set_window_hidden, close_window, arrange, type desk_window } from "../index.ts"
import { adopt, latest_bytes, document_of, is_dirty, announce_edit } from "../plugin/flow.ts"
import { render_window } from "../window/index.ts"
import { init_desktop_groups } from "./windows/groups.ts"

const drag_type = "application/x-jazu-window"
function element<K extends keyof HTMLElementTagNameMap>(tag: K, class_name = "", value = ""): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag)
    node.className = class_name; node.textContent = value
    return node
}

export function compare_windows(parent: desk_window, child: desk_window): boolean {
    if (state.desk?.hasAttribute("data-fixed") || parent === child || !parent.file || !child.file || !state.windows.includes(parent) || !state.windows.includes(child)) return false
    for (let ancestor: desk_window | null = parent; ancestor; ancestor = ancestor.parent) if (ancestor === child) return false
    const source = document_of(child), bytes = latest_bytes(source), dirty = is_dirty(child)
    if (bytes) child.file = new Blob([new Uint8Array(bytes)], { type: child.mime })
    adopt(parent, child)
    child.picks = { own: true, mime: false, mode: true }
    if (bytes && dirty) announce_edit(child, bytes)
    render_window(child)
    arrange()
    return true
}

export function init_windows_menu(desk: HTMLElement): () => void {
    if (desk.hasAttribute("data-fixed")) return () => {}
    const side = desk.querySelector<HTMLElement>(".desk_side"), tabs = side?.querySelector(".desk_side_tabs_ul")
    if (!side || !tabs) return () => {}
    const abort = new AbortController(), signal = abort.signal
    const tab = element("li"), toggle = element("details", "desk_side_tabs_drop")
    toggle.name = "desk_side_tab"; toggle.dataset.path = "desk:windows"
    toggle.append(element("summary", "", text("desk_windows"))); tab.append(toggle); tabs.append(tab)
    const panel = element("div", "desk_side_page desk_windows_menu")
    panel.dataset.path = "desk:windows"; panel.hidden = true; panel.setAttribute("role", "feed")
    const entries = element("div", "desk_windows_entries"), map = element("details", "desk_map")
    map.dataset.mapAuto = ""; map.dataset.mapLayout = "flow"; map.setAttribute("open", "")
    map.append(element("summary", "", text("desk_map")))
    panel.append(entries, map); side.append(panel)
    const dispose_groups = init_desktop_groups(desk, panel, entries)
    let fingerprint = "", queued = false
    let draw_abort = new AbortController()
    const opened = new Map<number, boolean>()
    const make_entry = (item: desk_window, seen: Set<number>): HTMLElement => {
        const entry_signal = draw_abort.signal
        const article = element("article", "desk_side_item desk_window_entry")
        article.dataset.windowId = String(item.id); article.dataset.kind = "post"
        const box = element("details", "desk_side_item_box")
        const children = state.windows.filter(child => child.parent === item && !seen.has(child.id))
        box.open = opened.get(item.id) ?? children.length > 0
        box.addEventListener("toggle", () => opened.set(item.id, box.open), { signal: entry_signal })
        const head = element("summary", "desk_side_item_head")
        head.draggable = true
        head.append(element("span", "desk_side_item_icon", item.icon || state.data?.icons?.window || ""), element("h3", "desk_side_item_name", label_of(item)))
        head.append(element("span", "desk_side_item_code", item.hidden ? text("window_hidden") : item.minimized ? text("window_minimized") : `window:${item.id}`))
        const info = element("p", "desk_side_item_info", item.path || item.mime)
        const tools = element("div", "desk_side_item_tool")
        const action = (name: string, label: string, run: () => void) => {
            const button = element("button", "", label)
            button.type = "button"; button.dataset.windowAction = name
            button.addEventListener("click", event => { event.preventDefault(); run() }, { signal: entry_signal }); tools.append(button)
        }
        action("open", text("window_show"), () => {
            focus_window(item)
            if (matchMedia("(orientation: portrait)").matches) document.getElementById("head_menu")?.removeAttribute("open")
            item.el.focus({ preventScroll: true })
        })
        action("hide", text(item.hidden ? "window_unhide" : "window_hide"), () => set_window_hidden(item, !item.hidden))
        action("close", text("close_window"), () => close_window(item))
        head.addEventListener("dragstart", event => {
            event.dataTransfer?.setData(drag_type, String(item.id))
            if (event.dataTransfer) event.dataTransfer.effectAllowed = "link"
        }, { signal: entry_signal })
        head.addEventListener("dragover", event => {
            if (event.dataTransfer?.types.includes(drag_type) && item.file) { event.preventDefault(); event.dataTransfer.dropEffect = "link" }
        }, { signal: entry_signal })
        head.addEventListener("drop", event => {
            if (!event.dataTransfer?.types.includes(drag_type)) return
            event.preventDefault(); event.stopPropagation()
            const id = Number(event.dataTransfer.getData(drag_type))
            const child = state.windows.find(window => window.id === id)
            if (child && compare_windows(item, child)) opened.set(item.id, true)
        }, { signal: entry_signal })
        box.append(head, info, tools)
        if (children.length) {
            const list = element("ul", "desk_side_item_sub")
            for (const child of children) { seen.add(child.id); const li = element("li"); li.append(make_entry(child, seen)); list.append(li) }
            box.append(list)
        }
        article.append(box)
        return article
    }
    const draw = () => {
        if (signal.aborted) return
        const key = JSON.stringify(state.windows.map(item => [item.id, item.name, item.path, item.mime, item.icon, item.parent?.id, item.minimized, Boolean(item.hidden)]))
        if (key === fingerprint) return
        fingerprint = key
        draw_abort.abort(); draw_abort = new AbortController()
        for (const id of opened.keys()) if (!state.windows.some(item => item.id === id)) opened.delete(id)
        const active = document.activeElement as HTMLElement | null
        const focus_id = active?.closest<HTMLElement>(".desk_window_entry")?.dataset.windowId, focus_action = active?.dataset.windowAction
        const seen = new Set<number>(), nodes: HTMLElement[] = []
        for (const item of state.windows.filter(item => !item.parent || !state.windows.includes(item.parent))) { seen.add(item.id); nodes.push(make_entry(item, seen)) }
        for (const item of state.windows) if (!seen.has(item.id)) { seen.add(item.id); nodes.push(make_entry(item, seen)) }
        if (!nodes.length) nodes.push(element("p", "", text("windows_empty")))
        entries.replaceChildren(...nodes)
        if (focus_id && focus_action) entries.querySelector<HTMLElement>(`[data-window-id="${focus_id}"] [data-window-action="${focus_action}"]`)?.focus({ preventScroll: true })
    }
    document.addEventListener("jazu:desk:change", () => {
        if (queued) return
        queued = true; queueMicrotask(() => { queued = false; draw() })
    }, { signal })
    draw()
    return () => { dispose_groups(); abort.abort(); draw_abort.abort(); panel.remove(); tab.remove() }
}
