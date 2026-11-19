import { new_window, state, text, focus_window, toggle_maximize } from "./desk.ts"
import { open_source, set_mode } from "./desk_view.ts"
import type { Server_Link } from "./server_link.ts"
import { Window_Store, window_uri } from "./server_windows.ts"
import { Session_Store } from "./server_sessions_model.ts"
import type { Window_Info } from "../../../server/src/shared/protocol.ts"

export function mount_sessions(link: Server_Link, windows: Window_Store): () => void {
    const aside = state.desk?.querySelector<HTMLElement>(".desk_side")
    const page = aside?.querySelector<HTMLElement>('.desk_side_page[data-path="server:sessions"]')
    if (!aside || !page) return () => {}
    const scripts = new Session_Store()
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
    const row = (name: string, uri: string, close: () => void): HTMLElement => {
        const entry = document.createElement("div"); entry.className = "server_session_row"
        const button = document.createElement("button"); button.type = "button"; button.className = "server_session_open"
        button.textContent = name; button.title = uri; button.dataset.sessionUri = uri
        button.addEventListener("click", () => { void open(uri) })
        const stop = document.createElement("button"); stop.type = "button"; stop.className = "server_session_close"
        stop.textContent = "×"; stop.title = stop.ariaLabel = text("close_window"); stop.addEventListener("click", close)
        entry.append(button, stop); return entry
    }
    const site = (window: Window_Info) => row(window.title || window.url || `#${window.id}`, window_uri(window.id), () => link.send({ t: "window_close", id: window.id }))
    const draw = () => {
        const sessions = scripts.list(windows.all())
        const nodes: HTMLElement[] = []
        for (const script of sessions.scripts) {
            const group = document.createElement("section"); group.className = "server_session_script"
            group.append(row(script.path.split("/").pop() || script.path, `file://${script.path}`, () => link.send({ t: "auto_stop", path: script.path })))
            const children = document.createElement("div"); children.className = "server_session_windows"
            children.append(...script.windows.map(site)); group.append(children); nodes.push(group)
        }
        nodes.push(...sessions.windows.map(site))
        if (!nodes.length) { const empty = document.createElement("p"); empty.className = "server_sessions_empty"; empty.textContent = text("server_sessions_empty"); nodes.push(empty) }
        page.replaceChildren(...nodes)
    }
    const update = (message: { t: string, [key: string]: unknown }) => { scripts.apply(message); draw() }
    const offs = [link.on("auto_state", update), link.on("auto_status", update), windows.on_change(draw),
        link.on("disconnected", () => { scripts.clear(); draw() })]
    page.style.display = "block"
    sync_tabs(); draw()
    return () => {
        for (const off of offs) off()
        for (const tab of tabs) tab.removeEventListener("toggle", sync_tabs)
        scripts.clear(); page.replaceChildren()
    }
}
