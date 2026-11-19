/*
 * The "view" of an application/auto-site source: the live picture of a Chromium window of the Pi, with its address bar and your pointer and keyboard.
 *
 * Entities
 *   auto_site_body      plugin host `auto_site`: builds the body; for a window that has no source it asks the Pi to open the site
 *   init_site_sources   registers the sources of this view: http(s):// URLs and server:window:<id> (a window of a running script, or DevTools)
 * Sources
 *   https://...         a standalone site; its key is a hash of the URL, so every desk window of that URL meets the same Chromium window
 *   file *.auto.site    the first http(s) line of the file is the URL (the file is the bookmark; "view" shows it live, "edit" is the text)
 *   server:window:<id>  a window a script opened (the log view lists them) or the DevTools picture of one
 * Scope
 *   Only with the owner's link. Video arrives as JPEG frames of exactly the page's size, so a position in the picture is a position in the page.
 *   One stream per tab (the agent keeps the newest request): the window you touched last is the one that moves.
 *   Closing the desk window closes the Pi's site window unless another desk window shows it; closing a script's window is up to the script.
 * Limits
 *   Frames that arrive while one is still decoding replace each other, so a slow screen shows the newest picture, never a queue.
 */
import type { desk_window } from "./desk.ts"
import { new_window, state, text } from "./desk.ts"
import { open_source, render_window, uri_handlers, process_hooks } from "./desk_view.ts"
import { owner_link, owner_windows } from "./desk_server_owner.ts"
import { Touch_control } from "./server_touch.ts"
import { server_audio } from "./server_audio.ts"
import { Click_Counter, copy_shortcut, key_events, modifiers, mouse_button, page_point, wheel_pixels } from "./server_input.ts"
import { is_site_url, site_key, site_url_of, window_id_of, window_uri } from "./server_windows.ts"
import type { Input_Event, Window_Info } from "../../../server/src/shared/protocol.ts"

export const site_mime = "application/auto-site"
const fit_debounce_ms = 150
const min_fit_px = 100

type Source = { kind: "window", id: number } | { kind: "site", key: string, url: string } | { kind: "error", message: string }

// desk windows that show each site key: the Pi's window is closed when the last of them goes
const site_users = new Map<string, Set<desk_window>>()

async function resolve_source(item: desk_window): Promise<Source> {
    const path = item.path.trim()
    const id = window_id_of(path)
    if (id !== null) return { kind: "window", id }
    if (is_site_url(path)) return { kind: "site", key: site_key(path), url: path }
    if (item.file) {
        const url = site_url_of(await item.file.text())
        if (url) return { kind: "site", key: site_key(url), url }
        return { kind: "error", message: text("server_site_invalid") }
    }
    return { kind: "error", message: text("server_site_invalid") }
}

function make<K extends keyof HTMLElementTagNameMap>(tag: K, class_name: string, content = ""): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag)
    element.className = class_name
    if (content) element.textContent = content
    return element
}

function bar_button(label: string, title: string): HTMLButtonElement {
    const button = make("button", "server_site_button", label)
    button.type = "button"
    button.title = title
    button.setAttribute("aria-label", title)
    return button
}

export function auto_site_body(item: desk_window, signal: AbortSignal, fallback: () => HTMLElement): HTMLElement {
    const link = owner_link()
    if (!link) return fallback()
    const root = make("div", "server_site")
    const note = make("div", "server_site_note")
    root.append(note)
    void resolve_source(item).then(source => {
        if (signal.aborted) return
        if (source.kind === "error") { note.textContent = source.message; return }
        note.remove()
        root.append(...build(item, signal, link, source))
    })
    return root
}

function build(item: desk_window, signal: AbortSignal, link: NonNullable<ReturnType<typeof owner_link>>, source: Exclude<Source, { kind: "error" }>): HTMLElement[] {
    const store = owner_windows
    let fit = true
    let watched: number | null = null
    let asked_open = false
    let want_tools = false
    let last_fit = ""

    // ---- the window this view shows: a given id, or the site's window once the Pi has opened it
    const current_id = (): number | null => source.kind === "window" ? source.id : (store.of_site(source.key)?.id ?? null)
    const picture = () => { const id = current_id(); return id === null ? undefined : store.picture(id) }
    const info = (): Window_Info | undefined => picture()?.owner
    const target = () => { const shown = picture(); return shown ? { id: shown.id, width: shown.width, height: shown.height } : null }

    // ---- DOM
    const back = bar_button("←", text("server_site_back"))
    const forward = bar_button("→", text("server_site_forward"))
    const reload = bar_button("⟳", text("server_site_reload"))
    const address = make("input", "server_site_address")
    address.type = "text"
    address.spellcheck = false
    address.setAttribute("aria-label", text("server_site_address"))
    const fit_button = bar_button("⤢", text("server_site_fit"))
    fit_button.setAttribute("aria-pressed", "true")
    const tools_button = bar_button("</>", text("server_site_devtools"))
    const audio = server_audio()
    const sound_button = bar_button("♪", text("server_site_sound"))
    sound_button.hidden = !audio.is_supported
    const bar = make("div", "server_site_bar")
    bar.append(back, forward, reload, address, fit_button, sound_button, tools_button)

    const feed = make("div", "server_site_feed")
    const canvas = make("canvas", "server_site_canvas")
    canvas.hidden = true
    const keys = make("textarea", "server_site_keys")
    keys.setAttribute("aria-label", text("server_site_keyboard"))
    keys.autocapitalize = "off"
    keys.spellcheck = false
    feed.append(canvas, keys)
    const touch = new Touch_control(feed, canvas, { target, send: input => send(input), focus_keys: () => keys.focus({ preventScroll: true }) })
    const context = canvas.getContext("2d")

    const send = (input: Input_Event): void => { const shown = target(); if (shown) link.send({ t: "window_input", id: shown.id, input }) }

    // ---- the stream: which picture, how wide
    const watch = (force = false): void => {
        const id = document.hidden || !feed.isConnected || feed.offsetParent === null ? null : current_id()
        if (!force && id === watched) return
        // nothing of the old window's sound may linger when another one is watched
        if (id !== watched) audio.reset()
        watched = id
        link.send({ t: "feed_watch", id, max_width: Math.ceil(feed.clientWidth * (window.devicePixelRatio || 1)) || 1280, audio: id !== null && audio.is_wanted })
    }
    const draw_state = (): void => {
        const shown = picture()
        if (shown) { delete feed.dataset.state; return }
        feed.dataset.state = !link.connected || !link.online ? text("server_offline") : source.kind === "window" ? text("server_site_gone") : text("server_site_connecting")
        canvas.hidden = true
    }
    const sync = (): void => {
        const window_info = info()
        // the DevTools picture of a window has no address bar of its own
        const shown_now = picture()
        bar.hidden = source.kind === "window" && shown_now !== undefined && shown_now.id !== shown_now.owner.id
        back.disabled = !(window_info?.can_back)
        forward.disabled = !(window_info?.can_forward)
        if (window_info && document.activeElement !== address) address.value = window_info.url
        tools_button.disabled = !window_info
        tools_button.classList.toggle("active", Boolean(window_info?.devtools))
        if (window_info?.devtools && want_tools) { want_tools = false; open_devtools_window(window_info.devtools.id) }
        draw_state()
        watch()
        const shown = picture()
        if (shown && (canvas.width !== shown.width || canvas.height !== shown.height)) { canvas.width = shown.width; canvas.height = shown.height; touch.refresh() }
        if (source.kind === "site" && !window_info && link.connected && link.online && !asked_open) { asked_open = true; open_site() }
    }
    const open_site = (): void => {
        if (source.kind !== "site") return
        const users = site_users.get(source.key) ?? new Set()
        users.add(item)
        site_users.set(source.key, users)
        link.send({ t: "site_open", key: source.key, url: source.url })
    }
    const open_devtools_window = (id: number): void => {
        const created = new_window()
        if (created) void open_source(created, window_uri(id))
    }

    // ---- fitting the page to the window
    let fit_timer: number | undefined
    const apply_fit = (): void => {
        const shown = picture()
        if (!shown || shown.id !== info()?.id) return
        const width = Math.floor(feed.clientWidth), height = Math.floor(feed.clientHeight)
        const size = fit && width >= min_fit_px && height >= min_fit_px ? { width, height } : null
        const signature = size ? `${size.width}x${size.height}` : "default"
        if (signature === last_fit) return
        last_fit = signature
        link.send({ t: "window_resize", id: shown.id, size })
    }
    const schedule_fit = (): void => { clearTimeout(fit_timer); fit_timer = window.setTimeout(() => { apply_fit(); watch(true) }, fit_debounce_ms) }
    const observer = new ResizeObserver(schedule_fit)
    observer.observe(feed)

    // ---- frames
    let busy = false
    let latest: Uint8Array | null = null
    const paint = async (bytes: Uint8Array): Promise<void> => {
        if (busy) { latest = bytes; return }
        busy = true
        try {
            const bitmap = await createImageBitmap(new Blob([bytes.slice().buffer], { type: "image/jpeg" }))
            if (!signal.aborted && context) {
                if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) { canvas.width = bitmap.width; canvas.height = bitmap.height; touch.refresh() }
                context.drawImage(bitmap, 0, 0)
                canvas.hidden = false
                delete feed.dataset.state
            }
            bitmap.close()
        } catch { /* a broken frame is skipped */ }
        busy = false
        if (latest) { const next = latest; latest = null; void paint(next) }
    }
    const off_frames = link.on_binary(frame => {
        if (frame.id !== current_id()) return
        if (frame.kind === "video") void paint(frame.payload)
        else audio.push(frame.timestamp, frame.payload)
    })

    // ---- pointer
    let pending_move: { x: number, y: number } | null = null
    const clicks = new Click_Counter()
    const point_of = (event: { clientX: number, clientY: number }) => page_point(canvas.getBoundingClientRect(), target(), event)
    const flush_move = (): void => { if (!pending_move) return; send({ kind: "mouse", action: "move", ...pending_move }); pending_move = null }
    canvas.addEventListener("contextmenu", event => event.preventDefault())
    canvas.addEventListener("pointerdown", event => {
        if (event.pointerType === "touch") return
        canvas.setPointerCapture(event.pointerId)
        keys.focus({ preventScroll: true })
        event.preventDefault()
        flush_move()
        send({ kind: "mouse", action: "down", ...point_of(event), button: mouse_button(event.button), clicks: clicks.press(event.timeStamp, event.clientX, event.clientY), modifiers: modifiers(event) })
    })
    canvas.addEventListener("pointermove", event => {
        if (event.pointerType === "touch") return
        const idle = pending_move === null
        pending_move = point_of(event)
        if (idle) requestAnimationFrame(flush_move)
    })
    const release = (event: PointerEvent): void => {
        if (event.pointerType === "touch") return
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
        send({ kind: "mouse", action: "up", ...point_of(event), button: mouse_button(event.button), clicks: clicks.count, modifiers: modifiers(event) })
    }
    canvas.addEventListener("pointerup", release)
    canvas.addEventListener("pointercancel", release)
    canvas.addEventListener("wheel", event => {
        event.preventDefault()
        const shown = target()
        const width = canvas.getBoundingClientRect().width
        const scale = shown ? shown.width / (width || shown.width) : 1
        send({ kind: "mouse", action: "wheel", ...point_of(event), ...wheel_pixels(event, canvas.clientHeight, scale) })
    }, { passive: false })

    // ---- keyboard and clipboard (the hidden field owns the keyboard, so typing works on phones too)
    const press = (action: "down" | "up", event: KeyboardEvent): void => {
        const result = key_events(action, event)
        if (result === "ignore") return
        event.preventDefault()
        const shown = target()
        if (result === "copy" || result === "cut") { if (shown) link.send({ t: "clipboard_copy", id: shown.id, cut: result === "cut" }); return }
        for (const input of result) send(input)
    }
    keys.addEventListener("keydown", event => press("down", event))
    keys.addEventListener("keyup", event => { if (!copy_shortcut(event)) press("up", event) })
    keys.addEventListener("beforeinput", event => {
        const name = event.inputType === "deleteContentBackward" ? "Backspace" : event.inputType === "insertLineBreak" || event.inputType === "insertParagraph" ? "Enter" : ""
        if (!name) return
        event.preventDefault()
        send({ kind: "key", action: "down", key: name }); send({ kind: "key", action: "up", key: name })
    })
    keys.addEventListener("input", event => {
        const { data, inputType, isComposing } = event as InputEvent
        if (!isComposing && data && (inputType === "insertText" || inputType === "insertCompositionText")) send({ kind: "text", text: data })
        keys.value = ""
    })
    keys.addEventListener("compositionend", event => { if (event.data) send({ kind: "text", text: event.data }); keys.value = "" })
    keys.addEventListener("paste", event => {
        event.preventDefault()
        const plain = event.clipboardData?.getData("text/plain") ?? ""
        const html = event.clipboardData?.getData("text/html") ?? ""
        const shown = target()
        if (shown && (plain || html)) link.send({ t: "clipboard_paste", id: shown.id, data: html ? { text: plain, html } : { text: plain } })
    })
    const off_clipboard = link.on("clipboard", message => {
        const data = message.data as { text: string, html?: string }
        if (!document.hasFocus() || !navigator.clipboard) return
        const write = data.html && typeof ClipboardItem !== "undefined"
            ? navigator.clipboard.write([new ClipboardItem({ "text/plain": new Blob([data.text], { type: "text/plain" }), "text/html": new Blob([data.html], { type: "text/html" }) })])
            : navigator.clipboard.writeText(data.text)
        void write.catch(() => undefined)
    })

    // ---- the bar
    back.addEventListener("click", () => { const id = current_id(); if (id !== null) link.send({ t: "window_navigate", id, delta: -1 }) })
    forward.addEventListener("click", () => { const id = current_id(); if (id !== null) link.send({ t: "window_navigate", id, delta: 1 }) })
    reload.addEventListener("click", () => { const id = current_id(); if (id !== null) link.send({ t: "window_navigate", id, delta: 0 }) })
    address.addEventListener("keydown", event => {
        if (event.key !== "Enter") return
        event.preventDefault()
        const id = current_id()
        const value = address.value.trim()
        if (id === null || !value) return
        const url = is_site_url(value) ? value : `https://${value}`
        if (is_site_url(url)) { link.send({ t: "window_navigate", id, url }); keys.focus({ preventScroll: true }) }
    })
    fit_button.addEventListener("click", () => {
        fit = !fit
        fit_button.classList.toggle("active", fit)
        fit_button.setAttribute("aria-pressed", String(fit))
        last_fit = ""
        apply_fit()
    })
    tools_button.addEventListener("click", () => {
        const window_info = info()
        if (!window_info) return
        if (window_info.devtools) link.send({ t: "window_devtools", id: window_info.id, open: false })
        else { want_tools = true; link.send({ t: "window_devtools", id: window_info.id, open: true }) }
    })
    const draw_sound = (): void => {
        sound_button.classList.toggle("active", audio.enabled && audio.is_running)
        sound_button.setAttribute("aria-pressed", String(audio.enabled))
        // the first touch unlocks the browser's audio: the stream then asks the Pi for sound
        if (audio.is_wanted !== wanted_sound) { wanted_sound = audio.is_wanted; watch(true) }
    }
    let wanted_sound = false
    sound_button.addEventListener("click", () => { audio.enabled = !audio.enabled })
    audio.on_change = draw_sound
    // the picture you touched last is the one the Pi streams
    const claim = (): void => watch(true)
    feed.addEventListener("pointerdown", claim)
    feed.addEventListener("focusin", claim)
    const on_visibility = (): void => watch(true)
    document.addEventListener("visibilitychange", on_visibility)

    draw_sound()
    const offs = [store.on_change(sync), link.on_state(sync), off_frames, off_clipboard]
    signal.addEventListener("abort", () => {
        for (const off of offs) off()
        if (audio.on_change === draw_sound) audio.on_change = () => {}
        audio.reset()
        observer.disconnect()
        clearTimeout(fit_timer)
        document.removeEventListener("visibilitychange", on_visibility)
        if (watched !== null) link.send({ t: "feed_watch", id: null, max_width: 1 })
        if (source.kind === "site") {
            const key = source.key
            // a mode switch re-renders the same window; only a window that is gone or shows something else lets go of the site
            setTimeout(() => {
                const users = site_users.get(key)
                if (!users) return
                if (!state.windows.includes(item) || item.mime !== site_mime) users.delete(item)
                if (users.size === 0) { site_users.delete(key); owner_link()?.send({ t: "site_close", key }) }
            }, 0)
        }
    }, { once: true })

    sync()
    return [bar, feed]
}

// An empty source for the window of an http(s):// address or a script's window: the item becomes a file-less application/auto-site window
export function init_site_sources(): void {
    if (uri_handlers.some(handler => (handler as { site?: boolean }).site)) return
    const handler = async (item: desk_window, uri: string): Promise<boolean> => {
        const trimmed = uri.trim()
        if (!owner_link() || !(is_site_url(trimmed) || window_id_of(trimmed) !== null)) return false
        process_hooks.release(item)
        item.file = null; item.save = null; item.pid = null; item.error = ""
        item.path = trimmed
        item.name = window_id_of(trimmed) !== null ? `window ${window_id_of(trimmed)}` : trimmed.replace(/^https?:\/\//, "")
        item.mime = site_mime
        item.candidates = [site_mime]
        item.icon = state.data?.mimes.find(info => info.mime === site_mime)?.icon ?? state.data?.file_icon ?? ""
        item.mode = "view"
        render_window(item)
        return true
    }
    ;(handler as { site?: boolean }).site = true
    uri_handlers.push(handler)
}
