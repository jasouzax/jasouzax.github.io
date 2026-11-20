import type { desk_window } from "./desk.ts"
import { text } from "./desk.ts"

const sound = new WeakMap<desk_window, boolean>()
export function window_audio_enabled(item: desk_window): boolean { return sound.get(item) ?? true }

// These controls belong to the window, so changing its viewer or mode keeps the preference.
export function bind_window_controls(item: desk_window): void {
    const full = item.el.querySelector<HTMLButtonElement>(".desk_wbox_head_fullscreen")
    const audio = item.el.querySelector<HTMLButtonElement>(".desk_wbox_head_audio")
    const draw = () => {
        full?.setAttribute("aria-pressed", String(document.fullscreenElement === item.el))
        audio?.setAttribute("aria-pressed", String(window_audio_enabled(item)))
        if (full) full.title = full.ariaLabel = text(document.fullscreenElement === item.el ? "window_exit_fullscreen" : "window_fullscreen")
    }
    full?.addEventListener("click", () => {
        const action = document.fullscreenElement === item.el ? document.exitFullscreen() : item.el.requestFullscreen?.()
        void action?.catch(() => {})
    })
    audio?.addEventListener("click", () => {
        const enabled = !window_audio_enabled(item)
        sound.set(item, enabled)
        for (const media of item.el.querySelectorAll<HTMLMediaElement>("audio, video")) media.muted = !enabled
        item.el.dispatchEvent(new CustomEvent("jazu:window-audio", { detail: { enabled } }))
        draw()
    })
    item.el.addEventListener("fullscreenchange", draw)
    draw()
}
