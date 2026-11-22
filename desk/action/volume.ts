/** Per-window audio preference and accessible mouse/touch volume popup.
 * Media elements and remote browser audio share the same level/mute state.
 */
import { state, text, type desk_window } from "../index.ts"

type Audio_State = { enabled: boolean, volume: number, last_volume: number }
const preferences = new WeakMap<desk_window, Audio_State>()
const redraws = new WeakMap<desk_window, () => void>()
export function window_audio_enabled(item: desk_window): boolean { return preferences.get(item)?.enabled ?? true }
export function window_volume(item: desk_window): number { return preferences.get(item)?.volume ?? 1 }

export function set_window_audio(item: desk_window, enabled: boolean, volume = window_volume(item)): void {
    const level = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : window_volume(item)
    preferences.set(item, { enabled, volume: level, last_volume: level > 0 ? level : preferences.get(item)?.last_volume ?? 1 })
    for (const media of item.el.querySelectorAll<HTMLMediaElement>("audio, video")) {
        if (media.muted === enabled) media.muted = !enabled
        if (media.volume !== level) media.volume = level
    }
    item.el.dispatchEvent(new CustomEvent("jazu:window-audio", { detail: { enabled, volume: level } }))
    redraws.get(item)?.()
}

export function remote_audio_state(item: desk_window, playing: boolean): void {
    item.el.toggleAttribute("data-audio-playing", playing)
    redraws.get(item)?.()
}

export function bind_volume(item: desk_window): () => void {
    const button = item.el.querySelector<HTMLButtonElement>(".desk_wbox_head_audio")
    if (!button) return () => {}
    const abort = new AbortController(), signal = abort.signal
    const popup = document.createElement("div")
    popup.className = "desk_volume_popup"; popup.hidden = true; popup.id = `desk_volume_${item.id}`
    popup.setAttribute("role", "group"); popup.setAttribute("aria-label", text("window_audio"))
    const range = document.createElement("input")
    range.type = "range"; range.min = "0"; range.max = "1"; range.step = ".01"
    range.setAttribute("aria-label", text("window_audio"))
    popup.append(range); document.body.append(popup)
    button.setAttribute("aria-controls", popup.id); button.setAttribute("aria-expanded", "false")
    const close = () => { popup.hidden = true; button.setAttribute("aria-expanded", "false") }
    const draw = () => {
        const media = [...item.el.querySelectorAll<HTMLMediaElement>("audio, video")]
        const remote = Boolean(item.el.querySelector(".server_site_feed")) && item.mode !== "edit"
        button.disabled = !media.length && !remote
        const enabled = window_audio_enabled(item), audible = enabled && window_volume(item) > 0
        button.setAttribute("aria-pressed", String(enabled))
        button.title = `${text("window_audio")}: ${text(audible ? "audio" : "mute")}`
        button.setAttribute("aria-label", text("window_audio"))
        const icon = state.data?.icons?.[audible ? "audio" : "mute"]
        if (icon && button.textContent !== icon) button.textContent = icon
        const playing = media.some(node => !node.paused && !node.ended) || (remote && item.el.hasAttribute("data-audio-playing"))
        button.toggleAttribute("data-muted-playing", !audible && playing)
        range.value = String(window_volume(item))
        range.setAttribute("aria-valuetext", `${Math.round(window_volume(item) * 100)}%`)
        if (button.disabled) close()
    }
    const show = () => {
        if (button.disabled) return
        if (!popup.hidden) { close(); return }
        const parent = document.fullscreenElement === item.el ? item.el : document.body
        if (popup.parentElement !== parent) parent.append(popup)
        popup.hidden = false
        const rect = button.getBoundingClientRect()
        popup.style.left = `${Math.max(8, Math.min(innerWidth - popup.offsetWidth - 8, rect.left))}px`
        popup.style.top = `${Math.max(8, Math.min(innerHeight - popup.offsetHeight - 8, rect.bottom + 4))}px`
        button.setAttribute("aria-expanded", "true")
        range.focus({ preventScroll: true })
    }
    let touch = false
    button.addEventListener("pointerdown", event => { touch = event.pointerType === "touch" }, { signal })
    button.addEventListener("pointercancel", () => { touch = false }, { signal })
    button.addEventListener("click", event => {
        if (touch) { touch = false; show() }
        else {
            const enabled = !window_audio_enabled(item) || window_volume(item) === 0
            const level = enabled && window_volume(item) === 0 ? preferences.get(item)?.last_volume ?? 1 : window_volume(item)
            set_window_audio(item, enabled, level)
        }
    }, { signal })
    button.addEventListener("contextmenu", event => { event.preventDefault(); touch = false; show() }, { signal })
    button.addEventListener("keydown", event => {
        if (event.key === "ArrowDown") { event.preventDefault(); show() }
    }, { signal })
    range.addEventListener("input", () => set_window_audio(item, Number(range.value) > 0, Number(range.value)), { signal })
    document.addEventListener("pointerdown", event => { if (!popup.contains(event.target as Node) && !button.contains(event.target as Node)) close() }, { signal, capture: true })
    popup.addEventListener("keydown", event => { if (event.key === "Escape") { event.preventDefault(); close(); button.focus() } }, { signal })
    addEventListener("resize", close, { signal })
    item.el.addEventListener("fullscreenchange", close, { signal })
    document.addEventListener("scroll", close, { signal, capture: true })
    for (const event of ["play", "pause", "ended", "volumechange"]) item.el.addEventListener(event, event => {
        if (event.type === "volumechange" && event.target instanceof HTMLMediaElement) {
            const media = event.target
            if (media.volume !== window_volume(item) || media.muted === window_audio_enabled(item)) set_window_audio(item, !media.muted, media.volume)
        }
        draw()
    }, { signal, capture: true })
    const observer = new MutationObserver(records => {
        if (records.some(record => !(record.target as Element).closest?.(".desk_wbox_head"))) draw()
    })
    item.el.addEventListener("jazu:window-state", draw, { signal })
    observer.observe(item.el, { childList: true, subtree: true })
    redraws.set(item, draw)
    draw()
    return () => { abort.abort(); observer.disconnect(); redraws.delete(item); popup.remove() }
}
