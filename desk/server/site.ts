/*
 * The "view" of an application/auto-site source: the live picture of a Chromium window of the Pi, with its address bar and your pointer and keyboard.
 *
 * Entities
 *   auto_site_body      plugin host `auto_site`: builds the body; for a window that has no source it asks the Pi to open the site
 *   init_site_sources   registers the sources of this view: http(s):// URLs and server:window:<id> (a window of a running script, or DevTools)
 * Sources
 *   https://...         a standalone site; its key is a hash of the URL, so every desk window of that URL meets the same Chromium window
 *   file *.auto.site    the first http(s) line of the file is the URL (the file is the bookmark; "view" shows it live, "edit" is the DevTools feed)
 *   server:window:<id>  a window a script opened (the log view lists them) or the DevTools picture of one
 * Scope
 *   Only with the owner's link. Video arrives as JPEG frames of exactly the page's size, so a position in the picture is a position in the page.
 *   One stream per tab (the agent keeps the newest request): the window you touched last is the one that moves.
 *   Closing a desk pane keeps its server session available in Sessions.
 * Limits
 *   Frames that arrive while one is still decoding replace each other, so a slow screen shows the newest picture, never a queue.
 */
import type { desk_window } from "../index.ts"
import { state, text } from "../index.ts"
import { render_window, uri_handlers, process_hooks } from "../window/index.ts"
import { owner_link, owner_windows } from "./owner.ts"
import { Touch_control } from "./touch.ts"
import { server_audio } from "./audio.ts"
import { override_navigation, sync_navigation, type Live_Navigation } from "../action/history.ts"
import { window_audio_enabled } from "../action/controls.ts"
import { window_volume, remote_audio_state } from "../action/volume.ts"
import { Click_Counter, copy_shortcut, key_events, modifiers, mouse_button, page_point, wheel_pixels } from "./input.ts"
import { is_site_url, site_key, site_url_of, window_id_of } from "./windows.ts"
import type { Input_Event, Window_Info } from "../../shared/protocol/wire.ts"

export const site_mime = "application/auto-site"
const fit_debounce_ms = 150
const min_fit_px = 100
let active_feed: desk_window | null = null

type Source = { kind: "window", id: number } | { kind: "site", key: string, url: string } | { kind: "error", message: string }

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
    let watched: number | null = null
    let asked_open = false
    let seen_window = false
    let tools_requested = false
    let last_fit = ""

    // ---- the window this view shows: a given id, or the site's window once the Pi has opened it
    const owner_id = (): number | null => source.kind === "window" ? (store.picture(source.id)?.owner.id ?? source.id) : (store.of_site(source.key)?.id ?? null)
    const info = (): Window_Info | undefined => { const id = owner_id(); return id === null ? undefined : store.get(id) }
    const picture = () => {
        if (item.mode === "edit") { const tools = info()?.devtools; return tools ? store.picture(tools.id) : undefined }
        const id = source.kind === "window" ? source.id : owner_id()
        return id === null ? undefined : store.picture(id)
    }
    const current_id = (): number | null => picture()?.id ?? null
    const target = () => { const shown = picture(); return shown ? { id: shown.id, width: shown.width, height: shown.height } : null }
    const audio = server_audio()
    const navigation: Live_Navigation = {
        path: info()?.url || (source.kind === "site" ? source.url : item.path), can_back: false, can_forward: false,
        open: value => {
            const id = owner_id(), uri = value.trim()
            const url = is_site_url(uri) ? uri : `https://${uri}`
            if (id !== null && uri && is_site_url(url)) link.send({ t: "window_navigate", id, url })
        },
        navigate: action => { const id = owner_id(); if (id !== null) link.send({ t: "window_navigate", id, delta: action === "previous" ? -1 : action === "forward" ? 1 : 0 }) },
    }
    const restore_navigation = override_navigation(item, navigation)

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
        if (active_feed && active_feed !== item) {
            if (state.focused !== item) return
            audio.reset()
            active_feed = item
        }
        // The agent watches the owning page and streams both it and its DevTools.
        const id = document.hidden || !feed.isConnected || feed.offsetParent === null ? null : owner_id()
        if (id !== null) active_feed = item
        if (!force && id === watched) return
        // nothing of the old window's sound may linger when another one is watched
        if (id !== watched) audio.reset()
        watched = id
        link.send({ t: "feed_watch", id, max_width: Math.ceil(feed.clientWidth * (window.devicePixelRatio || 1)) || 1280, audio: id !== null && item.mode !== "edit" && window_audio_enabled(item) && audio.is_wanted })
    }
    const draw_state = (): void => {
        const shown = picture()
        if (shown) { delete feed.dataset.state; return }
        feed.dataset.state = !link.connected || !link.online ? text("server_offline") : !seen_window && source.kind === "site" ? text("server_site_connecting") : text("server_site_gone")
        canvas.hidden = true
    }
    const sync = (): void => {
        const window_info = info()
        remote_audio_state(item, Boolean(window_info?.audible))
        if (window_info) { asked_open = true; seen_window = true }
        navigation.path = window_info?.url || navigation.path
        navigation.can_back = Boolean(window_info?.can_back)
        navigation.can_forward = Boolean(window_info?.can_forward)
        sync_navigation(item)
        if (item.mode === "edit" && window_info && !window_info.devtools && !tools_requested) {
            tools_requested = true
            link.send({ t: "window_devtools", id: window_info.id, open: true })
        }
        if (window_info?.devtools) tools_requested = false
        draw_state()
        watch()
        const shown = picture()
        if (shown && (canvas.width !== shown.width || canvas.height !== shown.height)) { canvas.width = shown.width; canvas.height = shown.height; touch.refresh() }
        if (source.kind === "site" && !window_info && link.connected && link.online && !asked_open) { asked_open = true; open_site() }
    }
    const open_site = (): void => {
        if (source.kind !== "site") return
        link.send({ t: "site_open", key: source.key, url: source.url })
    }
    // ---- fitting the page to the window
    let fit_timer: number | undefined
    const apply_fit = (): void => {
        const shown = picture()
        if (!shown) return
        const width = Math.floor(feed.clientWidth), height = Math.floor(feed.clientHeight)
        const size = width >= min_fit_px && height >= min_fit_px ? { width, height } : null
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
    let latest: { bytes: Uint8Array, id: number } | null = null
    const paint = async (bytes: Uint8Array, id: number): Promise<void> => {
        if (signal.aborted || id !== current_id() || !link.connected || !link.online) return
        if (busy) { latest = { bytes, id }; return }
        busy = true
        try {
            const bitmap = await createImageBitmap(new Blob([bytes.slice().buffer], { type: "image/jpeg" }))
            // Decoding may finish after a close, disconnect or source change; a stale picture must not revive the feed.
            if (!signal.aborted && context && id === current_id() && link.connected && link.online) {
                if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) { canvas.width = bitmap.width; canvas.height = bitmap.height; touch.refresh() }
                context.drawImage(bitmap, 0, 0)
                canvas.hidden = false
                delete feed.dataset.state
            }
            bitmap.close()
        } catch { /* a broken frame is skipped */ }
        busy = false
        if (latest) { const next = latest; latest = null; void paint(next.bytes, next.id) }
    }
    const off_frames = link.on_binary(frame => {
        if (frame.id !== current_id()) return
        if (frame.kind === "video") void paint(frame.payload, frame.id)
        else if (active_feed === item && window_audio_enabled(item) && item.mode !== "edit") audio.push(frame.timestamp, frame.payload)
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

    // The shared header owns sound; the feed only requests packets while this window wants them.
    let wanted_sound = false
    const draw_sound = (): void => {
        const wanted = window_audio_enabled(item) && audio.is_wanted
        if (wanted !== wanted_sound) { wanted_sound = wanted; watch(true) }
    }
    const change_sound = (): void => {
        active_feed = item
        audio.enabled = window_audio_enabled(item)
        audio.volume = window_volume(item)
        if (!audio.enabled) audio.reset()
        watch(true)
    }
    item.el.addEventListener("jazu:window-audio", change_sound)
    const off_sound = audio.on_change(draw_sound)
    // the picture you touched last is the one the Pi streams
    const claim = (): void => {
        if (active_feed !== item) audio.reset()
        active_feed = item
        if (audio.enabled !== window_audio_enabled(item)) audio.enabled = window_audio_enabled(item)
        audio.volume = window_volume(item)
        watch(true)
    }
    item.el.addEventListener("pointerdown", claim)
    feed.addEventListener("focusin", claim)
    const on_visibility = (): void => watch(true)
    document.addEventListener("visibilitychange", on_visibility)

    draw_sound()
    const offs = [store.on_change(sync), link.on_state(sync), off_frames, off_clipboard]
    signal.addEventListener("abort", () => {
        remote_audio_state(item, false)
        for (const off of offs) off()
        restore_navigation()
        item.el.removeEventListener("jazu:window-audio", change_sound)
        item.el.removeEventListener("pointerdown", claim)
        off_sound()
        observer.disconnect()
        clearTimeout(fit_timer)
        document.removeEventListener("visibilitychange", on_visibility)
        if (active_feed === item) {
            active_feed = null
            audio.reset()
            if (watched !== null) link.send({ t: "feed_watch", id: null, max_width: 1 })
        }

    }, { once: true })

    sync()
    return [feed]
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
