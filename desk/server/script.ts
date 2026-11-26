import { session_description } from "./sessions_model.ts"
/*
 * The "view" of an application/auto-javascript file: the script's log, and Start / Stop under it (Browsite's script view, as a desk window body).
 *
 * Entities
 *   auto_script_body   plugin host `auto_script`: builds the body for a window, or falls back to the plain code view when the owner's link is down
 * Scope
 *   The script runs on the Pi (server/browser/runner.ts), so closing this window or the tab never stops it; the view only mirrors it:
 *   `auto_logs` replays the history when the view opens, `auto_log` brings new lines, `auto_status` flips the button.
 * Limits
 *   Only the owner's desk has a link; everybody else sees the code read-only. Start runs the file as saved on the Pi (save edits first).
 */
import type { desk_window } from "../index.ts"
import { new_window, text } from "../index.ts"
import { open_source } from "../window/index.ts"
import { local_file_path } from "../fs/paths.ts"
import { owner_link, owner_windows } from "./owner.ts"
import { window_uri } from "./windows.ts"
import { Log_Store, count_label, log_stamp, max_log_entries } from "./script_model.ts"
import type { Log_Entry } from "../../shared/protocol/wire.ts"

function make<K extends keyof HTMLElementTagNameMap>(tag: K, class_name: string, content = ""): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag)
    element.className = class_name
    if (content) element.textContent = content
    return element
}

export function auto_script_body(item: desk_window, signal: AbortSignal, fallback: () => HTMLElement): HTMLElement {
    const link = owner_link()
    const path = local_file_path(item.path)
    if (!link || path === null) return fallback()
    const store = new Log_Store()
    let running = false
    let autostart = false
    let started_at: number | undefined, restart_at: number | undefined
    let restarting = false
    let errors_only = false

    const root = make("div", "server_script")
    const count = make("span", "server_script_count")
    const filter = make("button", "server_script_filter", text("server_script_errors_only"))
    filter.type = "button"
    filter.setAttribute("aria-pressed", "false")
    const clear = make("button", "server_script_clear", text("server_script_clear"))
    clear.type = "button"
    const head = make("div", "server_script_head")
    const actions = make("div", "server_script_actions")
    actions.append(filter, clear)
    head.append(count, actions)
    const list = make("div", "server_script_logs")
    list.setAttribute("role", "log")
    list.tabIndex = 0
    const state = make("span", "server_script_state")
    state.setAttribute("role", "status")
    const toggle = make("button", "server_script_toggle")
    toggle.type = "button"
    toggle.title = "Ctrl+Enter"
    const foot = make("div", "server_script_foot")
    foot.append(state, toggle)
    // the windows this script opened: each opens as a live feed in its own desk window
    const strip = make("div", "server_script_windows")
    const add_window = make("button", "server_script_new_window", "+")
    add_window.type = "button"
    add_window.title = add_window.ariaLabel = text("server_script_new_window")
    add_window.addEventListener("click", () => { link.send({ t: "window_create", script: path }) })
    root.append(head, list, strip, foot)

    const row = (entry: Log_Entry): HTMLElement => {
        const line = make("div", `server_script_log server_script_log_${entry.level}`)
        const time = make("time", "server_script_time", log_stamp(entry.time))
        time.dateTime = new Date(entry.time).toISOString()
        line.append(time, make("pre", "server_script_text", entry.text))
        return line
    }
    const refresh_count = (): void => {
        count.textContent = count_label(store.count(path), text("server_script_message"), text("server_script_messages"))
        list.dataset.empty = errors_only ? text("server_script_empty_errors") : text("server_script_empty")
    }
    const redraw_all = (): void => {
        list.replaceChildren(...store.get(path, errors_only).map(row))
        list.scrollTop = list.scrollHeight
        refresh_count()
    }
    const draw_state = (): void => {
        root.dataset.running = String(running)
        state.textContent = session_description({ running, restarting, started_at, restart_at })
        toggle.textContent = (running || autostart) ? text("server_script_stop") : text("server_script_start")
        toggle.disabled = !link.connected || !link.online
        draw_windows()
    }
    const draw_windows = (): void => {
        const chips = owner_windows.of_script(path).map(window_info => {
            const chip = make("button", "server_script_window", window_info.title || window_info.url || `#${window_info.id}`)
            chip.type = "button"
            chip.title = window_info.url
            chip.addEventListener("click", () => { const created = new_window(); if (created) void open_source(created, window_uri(window_info.id)) })
            return chip
        })
        strip.replaceChildren(...chips, add_window)
        strip.hidden = !running && chips.length === 0
    }
    const append = (entry: Log_Entry): void => {
        store.add(path, entry)
        if (errors_only && entry.level !== "error") { refresh_count(); return }
        // follow the output only while the reader is at the bottom, so older lines can be read undisturbed
        const at_bottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40
        list.append(row(entry))
        while (list.childElementCount > max_log_entries) list.firstElementChild?.remove()
        if (at_bottom) list.scrollTop = list.scrollHeight
        refresh_count()
    }
    const press = (): void => { link.send((running || autostart) ? { t: "auto_stop", path } : { t: "auto_start", path }) }

    toggle.addEventListener("click", press)
    clear.addEventListener("click", () => { link.send({ t: "auto_clear_logs", path }) })
    filter.addEventListener("click", () => {
        errors_only = !errors_only
        filter.classList.toggle("active", errors_only)
        filter.setAttribute("aria-pressed", String(errors_only))
        redraw_all()
    })
    root.addEventListener("keydown", event => { if (event.key === "Enter" && event.ctrlKey && !event.repeat) { event.preventDefault(); event.stopPropagation(); press() } })

    const offs = [
        link.on("auto_logs", message => { if (message.path === path) { store.set(path, message.entries as Log_Entry[]); redraw_all() } }),
        link.on("auto_log", message => { if (message.path === path) append(message.entry as Log_Entry) }),
        link.on("auto_logs_cleared", message => { if (message.path === path) { store.clear(path); redraw_all() } }),
        link.on("auto_status", message => { if (message.path === path) { running = Boolean(message.running); autostart = Boolean(message.autostart); restarting = Boolean(message.restarting); started_at = message.started_at as number | undefined; restart_at = message.restart_at as number | undefined; draw_state() } }),
        link.on("auto_deleted", message => { if (message.path === path) { running = autostart = restarting = false; store.clear(path); redraw_all(); draw_state() } }),
        link.on("auto_state", message => { const script = (message.scripts as { path: string, running: boolean, autostart?: boolean, restarting?: boolean, started_at?: number, restart_at?: number }[]).find(script => script.path === path); running = Boolean(script?.running); autostart = Boolean(script?.autostart); restarting = Boolean(script?.restarting); started_at = script?.started_at; restart_at = script?.restart_at; draw_state() }),
        link.on("auto_error", message => {
            if (message.path === path) append({ id: -Date.now(), time: Date.now(), level: "error", text: String(message.message ?? "") })
        }),
        link.on_state(draw_state),
        owner_windows.on_change(draw_windows),
    ]
    signal.addEventListener("abort", () => { for (const off of offs) off() }, { once: true })

    draw_state()
    redraw_all()
    const timer = window.setInterval(draw_state, 1000)
    signal.addEventListener("abort", () => clearInterval(timer), { once: true })
    link.send({ t: "auto_state" })
    link.send({ t: "auto_logs", path })
    return root
}
