/** Native fullscreen and video control inactivity. Keyboard focus and open controls keep tools visible. */
import { text, type desk_window } from "../index.ts"

export function bind_fullscreen(item: desk_window): () => void {
    const button = item.el.querySelector<HTMLButtonElement>(".desk_wbox_head_fullscreen")
    const abort = new AbortController(), signal = abort.signal
    let timer: ReturnType<typeof setTimeout> | null = null
    const video = () => item.el.querySelector<HTMLVideoElement>(".desk_wbox_body_media video")
    const reveal = () => {
        if (timer) clearTimeout(timer)
        item.el.removeAttribute("data-media-idle")
        const media = video()
        if (!media || media.paused || media.ended) return
        timer = setTimeout(() => {
            const focused = item.el.querySelector(":focus-visible")
            const open = item.el.querySelector("details[open]")
            const popup = document.getElementById(`desk_volume_${item.id}`)
            if (focused || open || (popup && !popup.hidden)) { reveal(); return }
            if (video() === media && !media.paused && !media.ended) item.el.setAttribute("data-media-idle", "")
        }, 2500)
    }
    const draw = () => {
        const full = document.fullscreenElement === item.el
        item.el.toggleAttribute("data-fullscreen-media", full && Boolean(video()))
        button?.setAttribute("aria-pressed", String(full))
        if (button) button.title = button.ariaLabel = text(full ? "window_exit_fullscreen" : "window_fullscreen")
        reveal()
    }
    button?.addEventListener("click", () => {
        const action = document.fullscreenElement === item.el ? document.exitFullscreen() : item.el.requestFullscreen?.()
        void action?.catch(() => {})
    }, { signal })
    item.el.addEventListener("fullscreenchange", draw, { signal })
    item.el.addEventListener("jazu:window-state", draw, { signal })
    for (const event of ["pointermove", "pointerdown", "keydown", "focusin", "play", "pause", "ended", "toggle"]) item.el.addEventListener(event, reveal, { signal, capture: true })
    const observer = new MutationObserver(draw)
    observer.observe(item.el, { childList: true })
    draw()
    return () => { abort.abort(); observer.disconnect(); if (timer) clearTimeout(timer); item.el.removeAttribute("data-media-idle"); item.el.removeAttribute("data-fullscreen-media") }
}
