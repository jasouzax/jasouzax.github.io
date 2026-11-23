import { new_window, state, text, focus_window, toggle_maximize } from "../index.ts"
import { open_source, set_mode } from "../window/index.ts"
import type { Server_Link } from "./link.ts"
import { Window_Store, window_uri } from "./windows.ts"
import { Session_Store } from "./sessions_model.ts"
import type { Window_Info } from "../../shared/protocol/wire.ts"
import { mount_api_sessions } from "./apis.ts"

export function mount_sessions(link: Server_Link, windows: Window_Store): () => void {
    const aside = state.desk?.querySelector<HTMLElement>(".desk_side")
    const page = aside?.querySelector<HTMLElement>('.desk_side_page[data-path="server:sessions"]')
    if (!aside || !page) return () => {}
    const scripts = new Session_Store()
    const api_panel = document.createElement("section")
    const release_apis = mount_api_sessions(api_panel)
    const tabs = [...aside.querySelectorAll<HTMLDetailsElement>(".desk_side_tabs_drop")]
    const sync_tabs = () => {
        const selected = tabs.find(tab => tab.open)?.dataset.path
        for (const panel of aside.querySelectorAll<HTMLElement>(".desk_side_page")) panel.hidden = panel.dataset.path !== selected
    }
    for (const tab of tabs) tab.addEventListener("toggle", sync_tabs)
    const open = async (uri: string) => {
        const item = state.windows.find(item => item.path === uri) ?? new_window()
        if (!item) return
        if (item.path !== uri) await open_source(item, uri)
        if (!state.windows.includes(item)) return
        set_mode(item, "view")
        if (state.maximized && state.maximized !== item) toggle_maximize(item)
        focus_window(item)
    }
    const expanded = new Map<string, boolean>()
    const icon_of = (mime: string) => state.data?.mimes.find(item => item.mime === mime)?.icon || state.data?.file_icon || ""
    const action = (name: string, label: string, glyph: string, run: () => void): HTMLButtonElement => {
        const button = document.createElement("button"); button.type = "button"
        button.dataset.sessionAction = name; button.title = label; button.setAttribute("aria-label", label)
        const icon = document.createElement("span"); icon.className = "desk_files_icon"; icon.setAttribute("aria-hidden", "true")
        icon.textContent = state.data?.icons?.[glyph] || ""
        button.append(icon, label); button.addEventListener("click", run); return button
    }
    const row = (name: string, uri: string, mime: string, tools: HTMLButtonElement[], info = "", default_open = false): { entry: HTMLElement, box: HTMLDetailsElement } => {
        const entry = document.createElement("article"); entry.className = "desk_side_item"
        entry.dataset.kind = "file"; entry.dataset.mime = mime; entry.dataset.path = uri
        const box = document.createElement("details"); box.className = "desk_side_item_box"
        box.open = expanded.get(uri) ?? default_open
        box.addEventListener("toggle", () => { if (box.isConnected) expanded.set(uri, box.open) })
        const head = document.createElement("summary"); head.className = "desk_side_item_head"
        const icon = document.createElement("span"); icon.className = "desk_side_item_icon"; icon.setAttribute("aria-hidden", "true"); icon.textContent = icon_of(mime)
        const title = document.createElement("h3"); title.className = "desk_side_item_name"
        const button = document.createElement("button"); button.type = "button"; button.className = "server_session_open"
        button.textContent = name; button.title = uri; button.dataset.sessionUri = uri
        title.append(button); head.append(icon, title)
        head.addEventListener("click", event => {
            event.preventDefault()
            box.open = (event.target as Element).closest("[data-session-uri]") ? true : !box.open
            expanded.set(uri, box.open); void open(uri)
        })
        box.append(head)
        if (info) { const note = document.createElement("p"); note.className = "desk_side_item_info"; note.textContent = info; box.append(note) }
        const bar = document.createElement("div"); bar.className = "desk_side_item_tool"; bar.setAttribute("role", "toolbar"); bar.setAttribute("aria-label", name)
        bar.append(...tools); box.append(bar); entry.append(box)
        return { entry, box }
    }
    const site = (window: Window_Info) => {
        const { entry } = row(window.title || window.url || `#${window.id}`, window_uri(window.id), "application/auto-site", [
            action("delete", text("files_delete"), "delete", () => link.send({ t: "window_close", id: window.id })),
        ])
        entry.classList.add("server_session_site"); return entry
    }
    const draw = () => {
        const sessions = scripts.list(windows.all())
        const nodes: HTMLElement[] = []
        for (const script of sessions.scripts) {
            const active = script.running || script.autostart
            const { entry, box } = row(script.path.split("/").pop() || script.path, `file://${script.path}`, "application/auto-javascript", [
                action(active ? "stop" : "start", text(active ? "server_script_stop" : "server_script_start"), active ? "pause" : "view", () => link.send({ t: active ? "auto_stop" : "auto_start", path: script.path })),
                action("window", text("server_script_new_window"), "window", () => link.send({ t: "window_create", script: script.path })),
                action("clear", text("server_script_clear"), "refresh", () => link.send({ t: "auto_clear_logs", path: script.path })),
                action("delete", text("files_delete"), "delete", () => link.send({ t: "auto_delete", path: script.path })),
            ], text(script.restarting ? "server_script_restarting" : script.running ? "server_script_running" : "server_script_stopped"), true)
            entry.classList.add("server_session_script"); entry.dataset.running = String(script.running)
            const children = document.createElement("ul"); children.className = "desk_side_item_sub server_session_windows"
            for (const window of script.windows) { const child = document.createElement("li"); child.append(site(window)); children.append(child) }
            box.append(children); nodes.push(entry)
        }
        nodes.push(...sessions.windows.map(site))
        if (!nodes.length) { const empty = document.createElement("p"); empty.className = "server_sessions_empty"; empty.textContent = text("server_sessions_empty"); nodes.push(empty) }
        // Keep the API form connected: moving it out of the DOM would blur an in-progress path edit.
        for (const child of [...page.children]) if (child !== api_panel) child.remove()
        if (api_panel.parentElement !== page) page.append(api_panel)
        api_panel.before(...nodes)
    }
    const update = (message: { t: string, [key: string]: unknown }) => { scripts.apply(message); draw() }
    const offs = [link.on("auto_state", update), link.on("auto_status", update), link.on("auto_deleted", update), windows.on_change(draw),
        link.on("disconnected", () => { scripts.clear(); draw() })]
    page.style.display = "block"
    sync_tabs(); draw()
    return () => {
        for (const off of offs) off()
        release_apis()
        for (const tab of tabs) tab.removeEventListener("toggle", sync_tabs)
        scripts.clear(); page.replaceChildren()
    }
}
