import { restart_session } from "./sessions/control.ts"
import { select_compute } from "../menu/computes.ts"
import { mount_options, option_group, option_button } from "../menu/options.ts"
import { session_description } from "./sessions_model.ts"
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
    const control_abort = new AbortController(), restarting = new Set<string>()
    const restart_script = (path: string) => {
        if (restarting.has(path)) return
        restarting.add(path)
        void restart_session(link, path, control_abort.signal).catch(error => { notice.textContent = error.message }).finally(() => restarting.delete(path))
    }
    const api_panel = document.createElement("section")
    const options = document.createElement("div"), notice = document.createElement("p"), row_tools = document.createElement("div"), api_tools = document.createElement("div")
    row_tools.className = "desk_files_buttons"; api_tools.className = "server_api_controls"
    notice.setAttribute("role", "status"); options.append(row_tools, notice, api_tools)
    const release_options = mount_options(page, options)
    const release_apis = mount_api_sessions(api_panel, api_tools)
    let selected = ""
    const new_script = option_button("Script", "file_new", () => {
        const path = prompt("Server script path (.auto.js)")?.trim()
        if (!path?.startsWith("/") || !path.endsWith(".auto.js")) return
        void (async () => {
            let exists = false
            try { const result = await link.fs({ op: "stat", path }); exists = result.op === "stat" && !!result.stat }
            catch (error) { if ((error as { code?: string }).code !== "ENOENT") throw error }
            if (exists) throw new Error("A script already exists at this path; select it to start it")
            const data = btoa("console.log('New script');\n")
            await link.fs({ op: "write", path, offset: 0, data, truncate: true })
            link.send({ t: "auto_start", path }); await open(`file://${path}`)
        })().catch(error => { notice.textContent = (error as Error).message })
    })
    const new_site = option_button("Site", "window", () => {
        const url = prompt("Site URL", "https://")?.trim()
        if (url && /^https?:\/\//.test(url)) link.send({ t: "site_open", key: crypto.randomUUID(), url })
    })
    const toggle = option_button("Start", "view"), clear = option_button(text("server_script_clear"), "refresh"), restart = option_button("Restart", "refresh"), remove = option_button(text("files_delete"), "delete")
    row_tools.append(option_group("New", new_script, new_site), option_group("Session", toggle, clear, restart, remove))
    const selected_tools = () => [...page.querySelectorAll<HTMLElement>("[data-session-entry]")].find(entry => entry.dataset.sessionEntry === selected)?.querySelector<HTMLElement>(".desk_side_item_tool")
    const run = (action: string) => selected_tools()?.querySelector<HTMLButtonElement>(`[data-session-action="${action}"]`)?.click()
    toggle.addEventListener("click", () => run(toggle.dataset.action || "start"))
    clear.addEventListener("click", () => run("clear")); restart.addEventListener("click", () => run("restart")); remove.addEventListener("click", () => run("delete"))
    const sync_options = () => {
        new_script.disabled = !!state.focused
        const tools = selected_tools(), active = !!tools?.querySelector('[data-session-action="stop"]')
        toggle.dataset.action = active ? "stop" : "start"
        const caption = toggle.querySelector("span:last-child")!, label = active ? text("server_script_stop") : text("server_script_start")
        if (caption.textContent !== label) caption.textContent = label
        toggle.title = active ? text("server_script_stop") : text("server_script_start")
        toggle.disabled = !tools?.querySelector('[data-session-action="start"], [data-session-action="stop"]')
        clear.disabled = restart.disabled = !tools?.querySelector('[data-session-action="clear"]')
        remove.disabled = !tools
    }
    const focus_changed = () => sync_options()
    document.addEventListener("jazu:desk:change", focus_changed)
    const tabs = [...aside.querySelectorAll<HTMLDetailsElement>(".desk_side_tabs_drop")]
    const sync_tabs = () => {
        const selected = tabs.find(tab => tab.open)?.dataset.path
        for (const panel of aside.querySelectorAll<HTMLElement>(".desk_side_page")) panel.hidden = panel.dataset.path !== selected
    }
    for (const tab of tabs) tab.addEventListener("toggle", sync_tabs)
    const open = async (uri: string) => {
        if (uri.startsWith("file://")) await select_compute("personal-server")
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
        entry.dataset.sessionEntry = uri; entry.dataset.kind = "file"; entry.dataset.mime = mime; entry.dataset.path = uri
        const box = document.createElement("details"); box.className = "desk_side_item_box"
        box.open = expanded.get(uri) ?? default_open
        box.addEventListener("toggle", () => { if (box.isConnected) expanded.set(uri, box.open) })
        const head = document.createElement("summary"); head.className = "desk_side_item_head"
        const icon = document.createElement("span"); icon.className = "desk_side_item_icon"; icon.setAttribute("aria-hidden", "true"); icon.textContent = icon_of(mime)
        const title = document.createElement("h3"); title.className = "desk_side_item_name"
        const button = document.createElement("button"); button.type = "button"; button.className = "server_session_open"
        button.textContent = name; button.title = uri; button.dataset.sessionUri = uri
        title.append(button); head.append(icon, title)
        head.draggable = true
        head.addEventListener("dragstart", event => { event.dataTransfer?.setData("text/uri-list", uri); event.dataTransfer?.setData("text/plain", uri) })
        head.addEventListener("click", event => {
            event.preventDefault()
            box.open = (event.target as Element).closest("[data-session-uri]") ? true : !box.open
            expanded.set(uri, box.open); selected = uri; sync_options(); void open(uri)
        })
        box.append(head)
        if (info) { const note = document.createElement("p"); note.className = "desk_side_item_info"; note.textContent = info; box.append(note) }
        const bar = document.createElement("div"); bar.className = "desk_side_item_tool"; bar.setAttribute("role", "toolbar"); bar.setAttribute("aria-label", name)
        bar.append(...tools); bar.hidden = true; box.append(bar); entry.append(box)
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
                action("restart", "Restart", "refresh", () => restart_script(script.path)),
                action("window", text("server_script_new_window"), "window", () => link.send({ t: "window_create", script: script.path })),
                action("clear", text("server_script_clear"), "refresh", () => link.send({ t: "auto_clear_logs", path: script.path })),
                action("delete", text("files_delete"), "delete", () => link.send({ t: "auto_delete", path: script.path })),
            ], session_description(script), true)
            entry.classList.add("server_session_script"); entry.dataset.running = String(script.running)
            const children = document.createElement("ul"); children.className = "desk_side_item_sub server_session_windows"
            for (const window of script.windows) { const child = document.createElement("li"); child.append(site(window)); children.append(child) }
            box.append(children); nodes.push(entry)
        }
        nodes.push(...sessions.windows.map(site))

        // Keep the API form connected: moving it out of the DOM would blur an in-progress path edit.
        for (const child of [...page.children]) if (child !== api_panel) child.remove()
        if (api_panel.parentElement !== page) page.append(api_panel)
        api_panel.before(...nodes)
        sync_options()
    }
    const update = (message: { t: string, [key: string]: unknown }) => { scripts.apply(message); draw() }
    const offs = [link.on("auto_state", update), link.on("auto_status", update), link.on("auto_deleted", update), windows.on_change(draw),
        link.on("disconnected", () => { scripts.clear(); draw() })]
    page.style.display = "block"
    const ticker = window.setInterval(() => {
        for (const script of scripts.list(windows.all()).scripts) {
            const entry = [...page.querySelectorAll<HTMLElement>("[data-session-entry]")].find(node => node.dataset.sessionEntry === `file://${script.path}`)
            const info = entry?.querySelector<HTMLElement>(":scope > details > .desk_side_item_info")
            if (info) info.textContent = session_description(script)
        }
    }, 1000)
    sync_tabs(); draw()
    return () => {
        for (const off of offs) off()
        control_abort.abort(); clearInterval(ticker); document.removeEventListener("jazu:desk:change", focus_changed); release_options(); release_apis()
        for (const tab of tabs) tab.removeEventListener("toggle", sync_tabs)
        scripts.clear(); page.replaceChildren()
    }
}
