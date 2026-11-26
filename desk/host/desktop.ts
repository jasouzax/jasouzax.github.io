/* Local Electron desktop controls and filesystem mount. Ordinary browsers never receive a native capability. */
import type { Desktop_Info, Desktop_Request, Native_Window } from "../../shared/host/desktop.ts"
import type { Fs_Result } from "../../shared/protocol/wire.ts"
import { remote_directory } from "../server/fs.ts"
import { filesystem_initialized, swap_root } from "../fs/opfs.ts"

const pending = new Map<number, { resolve: (value: any) => void, reject: (error: Error) => void, timer: number }>()
let next_id = 1, initialized = false, info: Desktop_Info | null = null, starting = false
let restore: (() => Promise<void>) | null = null, panel: HTMLElement | null = null, generation = 0
let sync_queue: Promise<void> = Promise.resolve()
let mounting: AbortController | null = null
const local_desk = () => /^\/(?:[a-z]{2}\/)?desk(?:\/|$)/.test(location.pathname) && !!document.querySelector(".desk[data-runtime]")

export function desktop_request<T = unknown>(request: Desktop_Request): Promise<T> {
    const id = next_id++
    return new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => { pending.delete(id); reject(new Error("The desktop did not answer")) }, 15000)
        pending.set(id, { resolve, reject, timer })
        window.postMessage({ channel: "jazu-host", direction: "to_host", message: { type: "desktop", id, request } }, location.origin)
    })
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text = ""): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag); node.textContent = text; return node
}

function native_panel(): HTMLElement {
    const box = element("details"), title = element("summary", "This computer")
    box.className = "desk_native"; box.dataset.nativeDesktop = ""; box.append(title)
    const status = element("p", `${info!.user} · ${info!.platform}${info!.wm ? ` · ${info!.wm}` : ""}`)
    status.setAttribute("role", "status"); box.append(status)
    const run = (action: () => Promise<unknown>) => { void action().catch(error => { status.textContent = error.message }) }
    const button = (label: string, action: () => Promise<unknown>, parent: HTMLElement = box) => {
        const item = element("button", label); item.type = "button"; item.addEventListener("click", () => run(action)); parent.append(item)
    }
    const clipboard = element("textarea"); clipboard.setAttribute("aria-label", "System clipboard"); clipboard.rows = 2
    box.append(clipboard)
    button("Read clipboard", async () => { clipboard.value = (await desktop_request<{ text: string }>({ op: "clipboard_read" })).text })
    button("Write clipboard", () => desktop_request({ op: "clipboard_write", text: clipboard.value }))
    if (info!.audio) {
        const label = element("label", "System volume "), volume = element("input")
        volume.type = "range"; volume.min = "0"; volume.max = "100"; volume.value = "50"; volume.setAttribute("aria-label", "System volume")
        volume.addEventListener("change", () => run(async () => { await desktop_request({ op: "volume", level: Number(volume.value) / 100 }) }))
        label.append(volume); box.append(label)
        button("Read volume", async () => { const value = await desktop_request<{ level: number, muted: boolean }>({ op: "volume" }); volume.value = String(value.level * 100); status.textContent = value.muted ? "System audio muted" : `System volume ${Math.round(value.level * 100)}%` })
        button("Mute", () => desktop_request({ op: "volume", muted: true }))
        button("Unmute", () => desktop_request({ op: "volume", muted: false }))
    }
    const windows = element("div"); windows.dataset.nativeWindows = ""
    if (info!.input) {
        const key = element("input"); key.placeholder = "Alt+Tab"; key.setAttribute("aria-label", "System key combination"); box.append(key)
        button("Send key", () => desktop_request({ op: "key", key: key.value }))
    }
    const refresh = async () => {
        const values = await desktop_request<Native_Window[]>({ op: "windows" })
        windows.replaceChildren()
        if (!values.length) windows.append(element("p", info!.wm ? "No native windows" : "Window placement requires i3, Sway, Hyprland or an X11 window manager"))
        for (const value of values) {
            const row = element("fieldset"), legend = element("legend", value.title || value.app)
            row.append(legend)
            const fields = (["x", "y", "width", "height"] as const).map(key => {
                const label = element("label", `${key} `), input = element("input")
                input.type = "number"; input.value = String(value[key]); input.setAttribute("aria-label", `${value.title} ${key}`)
                input.min = key === "width" || key === "height" ? "1" : "-65536"; input.max = key === "width" || key === "height" ? "32768" : "65536"
                label.append(input); row.append(label); return input
            })
            button("Place", async () => { await desktop_request({ op: "place", id: value.id, rect: { x: +fields[0].value, y: +fields[1].value, width: +fields[2].value, height: +fields[3].value } }); await refresh() }, row)
            button("Focus", () => desktop_request({ op: "focus", id: value.id }), row)
            button("Close window", async () => { if (window.confirm(`Close ${value.title || value.app}?`)) { await desktop_request({ op: "window_close", id: value.id }); await refresh() } }, row)
            windows.append(row)
        }
    }
    button("Refresh native windows", refresh); box.append(windows)
    box.addEventListener("toggle", () => { if (box.open) run(refresh) })
    return box
}

async function apply_desktop(): Promise<void> {
    if (!info) return
    const epoch = ++generation
    if (!local_desk()) { panel?.remove(); panel = null; const undo = restore; restore = null; await undo?.(); return }
    await filesystem_initialized()
    if (epoch !== generation || !local_desk()) return
    if (!restore) {
        const controller = mounting = new AbortController()
        try { restore = await swap_root(remote_directory({ fs: request => desktop_request<Fs_Result>({ op: "fs", request }) }), true, controller.signal) }
        catch (error) { if (!controller.signal.aborted) throw error; return }
        finally { if (mounting === controller) mounting = null }
    }
    if (epoch !== generation || !local_desk()) { const undo = restore; restore = null; await undo?.(); return }
    const desk = document.querySelector<HTMLElement>(".desk[data-runtime]")
    if (desk) desk.dataset.cwd = info.home
    if (!panel?.isConnected) { panel = native_panel(); document.querySelector('[data-options-for="file:///"]')?.append(panel) }
}

function sync_desktop(): Promise<void> {
    sync_queue = sync_queue.catch(() => {}).then(apply_desktop)
    return sync_queue
}

export function init_native_desktop(): void {
    if (initialized) return
    initialized = true
    window.addEventListener("message", event => {
        if (event.source !== window || event.origin !== location.origin || event.data?.channel !== "jazu-host" || event.data.direction !== "to_page") return
        const message = event.data.message
        if (message?.type === "desktop_result") {
            const current = pending.get(message.id)
            if (!current) return
            pending.delete(message.id); clearTimeout(current.timer)
            if (message.error) current.reject(Object.assign(new Error(message.error.message), { code: message.error.code }))
            else current.resolve(message.result)
        }
        if (message?.type === "hello" && message.extension === "electron" && !starting) {
            starting = true
            void desktop_request<Desktop_Info>({ op: "info" }).then(value => { info = value; return sync_desktop() }).catch(error => console.error("Desktop:", error)).finally(() => { starting = false })
        }
    })
    document.addEventListener("jazu:fs:init", () => { void sync_desktop().catch(console.error) })
    // Capture precedes init_desk's bubble listener: the next page must initialize against browser handles.
    document.addEventListener("jazu:page", () => {
        generation++; mounting?.abort()
        panel?.remove(); panel = null
        const undo = restore; restore = null; void undo?.()
    }, { capture: true })
}
