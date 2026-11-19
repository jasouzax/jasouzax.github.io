/*
 * The "view" of an application/auto-javascript file: the script's log, and Start / Stop under it (Browsite's script view, as a desk window body).
 *
 * Entities
 *   auto_script_body   plugin host `auto_script`: builds the body for a window, or falls back to the plain code view when the owner's link is down
 * Scope
 *   The script runs on the Pi (server/src/runner.ts), so closing this window or the tab never stops it; the view only mirrors it:
 *   `auto_logs` replays the history when the view opens, `auto_log` brings new lines, `auto_status` flips the button.
 * Limits
 *   Only the owner's desk has a link; everybody else sees the code read-only. Start runs the file as saved on the Pi (save edits first).
 */
import type { desk_window } from "./desk.ts"
import { text } from "./desk.ts"
import { local_file_path } from "./desk_paths.ts"
import { owner_link } from "./desk_server_owner.ts"
import { Log_Store, count_label, log_stamp, max_log_entries } from "./server_script_model.ts"
import type { Log_Entry } from "../../../server/src/shared/protocol.ts"

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
    root.append(head, list, foot)

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
        state.textContent = running ? text("server_script_running") : text("server_script_stopped")
        toggle.textContent = running ? text("server_script_stop") : text("server_script_start")
        toggle.disabled = !link.connected || !link.online
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
    const press = (): void => { link.send(running ? { t: "auto_stop", path } : { t: "auto_start", path }) }

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
        link.on("auto_status", message => { if (message.path === path) { running = Boolean(message.running); draw_state() } }),
        link.on("auto_state", message => { running = (message.scripts as { path: string, running: boolean }[]).some(script => script.path === path && script.running); draw_state() }),
        link.on("auto_error", message => {
            if (message.path === path) append({ id: -Date.now(), time: Date.now(), level: "error", text: String(message.message ?? "") })
        }),
        link.on_state(draw_state),
    ]
    signal.addEventListener("abort", () => { for (const off of offs) off() }, { once: true })

    draw_state()
    redraw_all()
    link.send({ t: "auto_state" })
    link.send({ t: "auto_logs", path })
    return root
}
