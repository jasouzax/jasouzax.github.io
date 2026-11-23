/* Explicitly saved, browser-local desktop groups. Temporary desks never write snapshots. */
import { state, text, close_window, new_window, working_directory } from "../../index.ts"
import { is_dirty } from "../../plugin/flow.ts"
import { register_map_resources } from "../map.ts"
import { register_navigation_guard } from "../../site/navigation.ts"
import { capture_desktop, desktop_signature, prepare_desktop, restore_desktop } from "./snapshot.ts"
import { list_desktops, read_desktop, write_desktop, delete_desktop, Desktop_Conflict } from "./store.ts"
import { valid_desktop_name, type Saved_Desktop, type Desktop_Snapshot } from "./model.ts"

function element<K extends keyof HTMLElementTagNameMap>(tag: K, class_name = "", value = ""): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag); node.className = class_name; node.textContent = value; return node
}
type Active = { id: string, name: string, revision: number, signature: string, conflicted: boolean }
class Unsupported_Desktop extends Error {}
export function init_desktop_groups(desk: HTMLElement, panel: HTMLElement, windows: HTMLElement): () => void {
    const abort = new AbortController(), signal = abort.signal, original_cwd = working_directory()
    const key = `jazu_desktop:${location.pathname}`
    const tools = element("form", "desktop_group_tools"), input = element("input"), status = element("p", "desktop_group_status", text("desktop_temporary")), groups = element("div", "desktop_group_list")
    status.setAttribute("role", "status"); input.maxLength = 80; input.name = "desktop_name"; input.setAttribute("aria-label", text("desktop_name")); input.placeholder = text("desktop_name")
    tools.append(input); panel.prepend(tools, status, groups)
    let active: Active | null = null, records: Saved_Desktop[] = [], busy = false, suspended = false, touched = false, timer = 0
    let writing: Promise<void> = Promise.resolve(), drawing = new AbortController(), channel: BroadcastChannel | undefined
    const controls: HTMLButtonElement[] = []
    const live = () => !signal.aborted && state.desk === desk && desk.isConnected
    const remember = (id: string | null) => { try { id ? sessionStorage.setItem(key, id) : sessionStorage.removeItem(key) } catch { /* storage denial must not destroy a live desk */ } }
    const fail = (error: unknown) => { if (live()) status.textContent = text(error instanceof Desktop_Conflict ? "desktop_conflict" : error instanceof Unsupported_Desktop ? "desktop_unsupported" : (error as DOMException)?.name === "ConstraintError" ? "desktop_exists" : "desktop_storage_error") }
    const announce = () => { try { channel?.postMessage("changed") } catch { /* other tabs can refresh explicitly */ } }
    const button = (parent: HTMLElement, label: string, action: string, run: () => void, event_signal = signal): HTMLButtonElement => {
        const node = element("button", "", label); node.type = "button"; node.dataset.desktopAction = action
        node.addEventListener("click", run, { signal: event_signal }); parent.append(node); return node
    }
    const enabled = () => {
        controls.forEach(node => node.disabled = busy)
        input.disabled = busy; save.disabled = leave.disabled = busy || !active
        for (const node of groups.querySelectorAll<HTMLButtonElement>("button")) node.disabled = busy
    }
    const paint = () => {
        if (!live()) return
        const focused = document.activeElement as HTMLElement | null
        drawing.abort(); drawing = new AbortController()
        // Reparent the live Windows tree; its own renderer/listeners remain authoritative.
        if (windows.parentElement !== panel) panel.insertBefore(windows, panel.querySelector(":scope > .desk_map"))
        groups.replaceChildren(...records.map(record => {
            const article = element("article", "desk_side_item desktop_group"), box = element("details", "desk_side_item_box"), head = element("summary", "desk_side_item_head")
            article.dataset.desktopId = record.id; article.dataset.kind = "post"; box.open = record.id === active?.id
            head.append(element("h3", "desk_side_item_name", record.name))
            const actions = element("div", "desk_side_item_tool")
            button(actions, text("desktop_open"), "open", () => perform(() => open(record.id)), drawing.signal)
            button(actions, text("desktop_delete"), "delete", () => perform(async () => {
                if (!confirm(text("desktop_delete_confirm"))) return
                await writing
                const revision = active?.id === record.id ? active.revision : record.revision
                await delete_desktop(record.id, revision)
                if (active?.id === record.id) { active = null; remember(null); delete desk.dataset.desktopGroup; status.textContent = text("desktop_temporary") }
                announce(); await refresh()
            }), drawing.signal)
            box.append(head, actions)
            if (record.id === active?.id) box.append(windows)
            article.append(box); return article
        }))
        enabled()
        if (focused?.isConnected && panel.contains(focused)) focused.focus({ preventScroll: true })
    }
    const refresh = async () => { const next = await list_desktops(); if (live()) { records = next; paint() } }
    const queue_snapshot = (group: Active, snapshot: Desktop_Snapshot, signature: string): Promise<void> => {
        writing = writing.catch(() => {}).then(async () => {
            if (group.conflicted) throw new Desktop_Conflict()
            if (group.signature === signature) return
            const record = await write_desktop(group.id, group.name, snapshot, group.revision)
            group.revision = record.revision; group.signature = signature
            if (live() && active === group) { status.textContent = text("desktop_saved").replace("{name}", group.name); announce(); await refresh() }
        }).catch(error => { if (error instanceof Desktop_Conflict) group.conflicted = true; fail(error); throw error })
        return writing
    }
    const flush = async () => {
        clearTimeout(timer)
        if (!active || suspended) return
        const signature = desktop_signature()
        if (active.signature === signature) { await writing; return }
        let snapshot: Desktop_Snapshot
        try { snapshot = capture_desktop() }
        catch { throw new Unsupported_Desktop() }
        status.textContent = text("desktop_saving")
        await queue_snapshot(active, snapshot, signature)
    }
    const schedule = () => {
        if (!live() || !active || suspended || busy || active.signature === desktop_signature()) return
        clearTimeout(timer); timer = window.setTimeout(() => { void flush().catch(() => {}) }, 250)
    }
    const perform = (job: () => Promise<void>) => {
        if (busy || !live()) return
        clearTimeout(timer); busy = true; enabled()
        void job().catch(fail).finally(() => { busy = false; if (live()) { enabled(); schedule() } })
    }
    const open = async (id: string, automatic = false) => {
        const record = await read_desktop(id), drafts = await prepare_desktop(record)
        if (!live() || automatic && touched) return
        if (active) await flush()
        else if (!automatic && state.windows.some(item => is_dirty(item) || item.dirty) && !confirm(text("desktop_replace_confirm"))) return
        suspended = true
        try {
            await restore_desktop(record, drafts, live)
            if (!live()) return
            active = { id: record.id, name: record.name, revision: record.revision, signature: desktop_signature(), conflicted: false }
            desk.dataset.desktopGroup = record.id; remember(record.id)
            status.textContent = text("desktop_saved").replace("{name}", record.name); await refresh()
        } finally { suspended = false }
    }
    const create = button(tools, text("desktop_create"), "create", () => perform(async () => {
        if (!valid_desktop_name(input.value)) { status.textContent = text("desktop_invalid_name"); return }
        let snapshot: Desktop_Snapshot
        try { snapshot = capture_desktop() } catch { status.textContent = text("desktop_unsupported"); return }
        const signature = desktop_signature(), name = input.value.trim()
        status.textContent = text("desktop_saving")
        await writing.catch(() => {})
        const record = await write_desktop(crypto.randomUUID(), name, snapshot, 0)
        if (!live()) return
        writing = Promise.resolve()
        active = { id: record.id, name: record.name, revision: record.revision, signature, conflicted: false }
        desk.dataset.desktopGroup = record.id; remember(record.id); input.value = ""
        status.textContent = text("desktop_saved").replace("{name}", name); announce(); await refresh()
    }))
    const save = button(tools, text("desktop_save"), "save", () => perform(flush))
    const leave = button(tools, text("desktop_leave"), "leave", () => perform(async () => {
        await flush(); active = null; remember(null); delete desk.dataset.desktopGroup; suspended = true
        try { for (const item of [...state.windows]) close_window(item); desk.dataset.cwd = original_cwd; new_window() }
        finally { suspended = false }
        status.textContent = text("desktop_temporary"); await refresh()
    }))
    controls.push(create, save, leave, button(tools, text("desktop_refresh"), "refresh", () => perform(refresh)))
    tools.addEventListener("submit", event => { event.preventDefault(); create.click() }, { signal })
    for (const event of ["input", "change", "jazu:desk:change", "jazu:window-audio"]) document.addEventListener(event, schedule, { signal, capture: event === "jazu:window-audio" })
    for (const event of ["pointerdown", "keydown", "input"]) document.addEventListener(event, () => { touched = true }, { signal, capture: true })
    document.addEventListener("visibilitychange", () => { if (document.hidden && !busy) void flush().catch(() => {}) }, { signal })
    addEventListener("beforeunload", event => {
        if (busy || active && active.signature !== desktop_signature()) { event.preventDefault(); event.returnValue = "" }
    }, { signal })
    register_navigation_guard(async () => {
        if (busy) return false
        try { await flush(); return true } catch { return false }
    }, signal)
    document.addEventListener("click", event => {
        const link = (event.target as Element).closest?.('a[href^="desktop:"]')
        if (!link) return
        event.preventDefault(); event.stopImmediatePropagation(); perform(() => open(link.getAttribute("href")!.slice(8)))
    }, { signal, capture: true })
    register_map_resources(() => ({
        nodes: records.map(record => ({ id: `desktop:${record.id}`, name: record.name, link: `desktop:${record.id}`, active: record.id === active?.id })),
        edges: active ? state.windows.filter(item => !item.parent).map(item => ({ from: `desktop:${active!.id}`, to: `window:${item.id}` })) : [],
    }), signal)
    try { channel = new BroadcastChannel("jazu_desktops"); channel.onmessage = () => { void refresh().catch(fail) } } catch { /* Refresh remains available without cross-tab notifications. */ }
    enabled()
    void refresh().then(async () => {
        let id: string | null = null; try { id = sessionStorage.getItem(key) } catch { /* local-only fallback */ }
        if (id && !touched) { busy = true; enabled(); try { await open(id, true) } finally { busy = false; if (live()) enabled() } }
    }).catch(fail)
    return () => {
        // Capture before index.ts disposes windows; serialize after any earlier transaction.
        if (active && !suspended && active.signature !== desktop_signature()) {
            try { void queue_snapshot(active, capture_desktop(), desktop_signature()).catch(() => {}) } catch { /* Failed snapshots never replace the previous record. */ }
        }
        clearTimeout(timer); abort.abort(); drawing.abort(); channel?.close()
        if (windows.parentElement !== panel) panel.append(windows)
        tools.remove(); status.remove(); groups.remove()
    }
}
