import type { desk_window } from "./desk.ts"
import { text } from "./desk.ts"
import { local_file_path } from "./desk_paths.ts"

type history = { entries: string[], index: number }
const histories = new WeakMap<desk_window, history>()
const actions = new WeakMap<desk_window, (action: string) => void>()
export function navigate_window(item: desk_window, action: "previous" | "refresh" | "forward"): void { actions.get(item)?.(action) }
export function remap_navigation(item: desk_window, remap: (uri: string) => string): void {
    const history = histories.get(item)
    if (history) history.entries = history.entries.map(remap)
}

export function url_parts(uri: string): { scheme: string, parts: { label: string, uri: string }[] } {
    const match = uri.match(/^([a-z][a-z\d+.-]*:(?:\/\/)?)(.*)$/i)
    if (!match) return { scheme: "", parts: [{ label: uri, uri }] }
    const [, scheme, tail] = match
    const local = local_file_path(uri)
    if (local !== null) {
        const parts = [{ label: "/", uri: "file:///" }]
        let path = ""
        for (const name of local.split("/").filter(Boolean)) { path += `/${name}`; parts.push({ label: name, uri: `file://${path}` }) }
        return { scheme, parts }
    }
    if (!scheme.endsWith("//")) return { scheme, parts: [{ label: tail, uri }] }
    let path = scheme
    const parts = tail.split("/").map((name, index) => { path += (index ? "/" : "") + name; return { label: name || "/", uri: path } })
    return { scheme, parts }
}

export function sync_navigation(item: desk_window): void {
    let history = histories.get(item)
    if (!history) { history = { entries: [], index: -1 }; histories.set(item, history) }
    if (history.entries[history.index] !== item.path) {
        history.entries.splice(history.index + 1); history.entries.push(item.path); history.index = history.entries.length - 1
    }
    const head = item.el.querySelector(".desk_wbox_head")
    const previous = head?.querySelector<HTMLButtonElement>('[data-navigation="previous"]')
    const forward = head?.querySelector<HTMLButtonElement>('[data-navigation="forward"]')
    if (previous) previous.disabled = history.index <= 0
    if (forward) forward.disabled = history.index >= history.entries.length - 1
    const input = head?.querySelector<HTMLInputElement>(".desk_wbox_head_path")
    if (input && document.activeElement !== input) input.value = item.path || item.name
    const crumbs = head?.querySelector<HTMLElement>(".desk_wbox_head_breadcrumbs")
    if (!crumbs) return
    crumbs.replaceChildren()
    const value = item.path || item.name
    crumbs.title = value
    const edit = document.createElement("button")
    edit.type = "button"; edit.className = "desk_wbox_head_scheme"; edit.dataset.urlEdit = ""
    const parts = url_parts(value)
    edit.textContent = parts.scheme || value || text("window_source")
    edit.setAttribute("aria-label", text("window_source"))
    crumbs.append(edit)
    if (!parts.scheme) return
    for (const [index, part] of parts.parts.entries()) {
        if (index && parts.parts[index - 1].label !== "/") {
            const separator = document.createElement("span"); separator.textContent = "/"; separator.setAttribute("aria-hidden", "true"); crumbs.append(separator)
        }
        const button = document.createElement("button")
        button.type = "button"; button.textContent = part.label; button.dataset.url = part.uri
        if (index === parts.parts.length - 1) button.setAttribute("aria-current", "location")
        crumbs.append(button)
    }
}

export function bind_navigation(item: desk_window, open: (uri: string) => Promise<void>, refresh: () => void): void {
    const head = item.el.querySelector(".desk_wbox_head")!
    const input = head.querySelector<HTMLInputElement>(".desk_wbox_head_path")!
    input.addEventListener("focus", () => input.select())
    input.addEventListener("keydown", event => {
        if (event.key === "Escape") { input.value = item.path || item.name; input.blur(); return }
        if (event.key !== "Enter") return
        event.preventDefault(); const value = input.value; input.blur(); void open(value)
    })
    const navigate = (action: string) => {
        if (action === "refresh") { refresh(); return }
        const history = histories.get(item)
        if (!history) return
        const index = history.index + (action === "previous" ? -1 : 1)
        if (index < 0 || index >= history.entries.length) return
        history.index = index
        void open(history.entries[index])
    }
    actions.set(item, navigate)
    head.addEventListener("click", event => {
        const target = event.target as Element
        if (target.closest("[data-url-edit]") || (target.closest(".desk_wbox_head_address") && !target.closest("[data-url], input"))) { input.value = item.path || item.name; input.focus(); input.select(); return }
        const crumb = target.closest<HTMLElement>("[data-url]")
        if (crumb?.dataset.url) { void open(crumb.dataset.url); return }
        const action = target.closest<HTMLElement>("[data-navigation]")?.dataset.navigation
        if (action) navigate(action)
    })
}
