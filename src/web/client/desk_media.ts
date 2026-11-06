import type { desk_window } from "./desk.ts"

// Inline strokes stay legible even before the site's icon font has loaded.
const icons: Record<string, string> = {
    Play: "m8 4 13 8-13 8Z", Pause: "M8 4v16M16 4v16",
    Mute: "m11 4-6 5H2v6h3l6 5ZM15 8q5 4 0 8M18 4q9 8 0 16",
    Unmute: "m11 4-6 5H2v6h3l6 5ZM16 9l6 6M22 9l-6 6",
    Fullscreen: "M9 3H3v6M15 3h6v6M3 15v6h6M21 15v6h-6",
    "Exit fullscreen": "M3 9h6V3M21 9h-6V3M9 21v-6H3M15 21v-6h6",
    "Picture in picture": "M3 3h18v18H3ZM11 11h8v8h-8Z",
    Settings: "M3 6h18M3 12h18M3 18h18M8 3v6M16 9v6M10 15v6",
    Subtitles: "M3 5h18v14H3ZM10 9H7v6h3M17 9h-3v6h3",
    "−": "M5 12h14", "+": "M5 12h14M12 5v14",
    Fit: "M9 3H3v6M15 3h6v6M3 15v6h6M21 15v6h-6M8 8h8v8H8Z",
    Rotate: "M4 10a8 8 0 1 1 2 8M4 3v7h7",
}

function button_icon(node: HTMLElement, label: string): void {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    svg.setAttribute("viewBox", "0 0 24 24")
    svg.setAttribute("aria-hidden", "true")
    const path = document.createElementNS(svg.namespaceURI, "path")
    path.setAttribute("d", icons[label] ?? icons.Settings)
    svg.append(path)
    node.replaceChildren(svg)
    node.title = label
    node.setAttribute("aria-label", label)
}

// The demo's head/media/timeline/tools layout, connected to the browser media API.
export function media_player(item: desk_window, url: string, failed: () => void): HTMLElement {
    const box = document.createElement("div")
    box.className = "desk_wbox_body_media"
    const head = document.createElement("div")
    head.className = "desk_wbox_body_media_head"
    const title = document.createElement("span")
    title.className = "desk_wbox_body_media_title"
    title.textContent = item.name
    head.append(title)
    const tools = document.createElement("div")
    tools.className = "desk_wbox_body_media_tool"
    const button = (label: string, action: () => void): HTMLButtonElement => {
        const node = document.createElement("button")
        node.type = "button"
        button_icon(node, label)
        node.addEventListener("click", action)
        tools.append(node)
        return node
    }
    const fullscreen = (): void => {
        void (document.fullscreenElement ? document.exitFullscreen() : box.requestFullscreen()).catch(() => {})
    }
    const popup = (label: string): HTMLDetailsElement => {
        const details = document.createElement("details")
        details.className = "desk_wbox_body_media_popup"
        const summary = document.createElement("summary")
        button_icon(summary, label)
        details.append(summary)
        details.addEventListener("keydown", event => {
            if (event.key === "Escape") { details.open = false; summary.focus() }
        })
        tools.append(details)
        return details
    }
    if (item.mime.startsWith("image/")) {
        const image = document.createElement("img")
        image.className = "desk_wbox_body_media_image"
        image.src = url
        image.alt = item.name
        image.draggable = false
        const viewport = document.createElement("div")
        viewport.className = "desk_wbox_body_media_viewport"
        viewport.append(image)
        let zoom = 1, rotation = 0
        const draw = (): void => { image.style.transform = `scale(${zoom}) rotate(${rotation}deg)` }
        button("−", () => { zoom = Math.max(.25, zoom / 1.25); draw() }).setAttribute("aria-label", "Zoom out")
        button("+", () => { zoom = Math.min(8, zoom * 1.25); draw() }).setAttribute("aria-label", "Zoom in")
        button("Fit", () => { zoom = 1; rotation = 0; draw() })
        button("Rotate", () => { rotation = (rotation + 90) % 360; draw() })
        button("Fullscreen", fullscreen)
        image.addEventListener("error", failed, { once: true })
        box.append(viewport, head, tools)
        return box
    }
    const media = document.createElement(item.mime.startsWith("video/") ? "video" : "audio")
    media.className = `desk_wbox_body_media_${media.tagName.toLowerCase()}`
    media.src = url
    media.preload = "metadata"
    if (media instanceof HTMLVideoElement) media.playsInline = true
    const timeline = document.createElement("div")
    timeline.className = "desk_wbox_body_media_time"
    const seek = document.createElement("input")
    seek.className = "desk_wbox_body_media_time_seek"
    seek.type = "range"
    seek.min = "0"; seek.max = "0"; seek.step = "0.1"; seek.value = "0"
    seek.disabled = true
    seek.setAttribute("aria-label", "Seek")
    seek.addEventListener("input", () => { media.currentTime = Number(seek.value) })
    timeline.append(seek)
    const play = button("Play", () => {
        if (media.paused) void media.play().catch(() => {})
        else media.pause()
    })
    const mute = button("Mute", () => {
        if (media.volume === 0) { media.volume = 1; media.muted = false }
        else media.muted = !media.muted
    })
    const volume = document.createElement("input")
    volume.type = "range"
    volume.min = "0"; volume.max = "1"; volume.step = "0.01"; volume.value = "1"
    volume.setAttribute("aria-label", "Volume")
    volume.addEventListener("input", () => { media.volume = Number(volume.value); media.muted = false })
    const volume_popup = popup("Mute")
    const volume_panel = document.createElement("div")
    volume_panel.className = "desk_wbox_body_media_popup_panel"
    volume_panel.append(mute, volume)
    volume_popup.append(volume_panel)
    const time = document.createElement("span")
    time.className = "desk_wbox_body_media_tool_time"
    const current = document.createElement("span")
    const duration = document.createElement("span")
    duration.className = "desk_wbox_body_media_tool_time_end"
    time.append(current, duration)
    tools.append(time)
    const rate = document.createElement("select")
    rate.setAttribute("aria-label", "Playback speed")
    for (const value of [.25, .5, 1, 1.5, 2]) {
        const option = document.createElement("option")
        option.value = String(value); option.textContent = `${value}×`; option.selected = value === 1
        rate.append(option)
    }
    rate.addEventListener("change", () => { media.playbackRate = Number(rate.value) })
    const settings = popup("Settings")
    const settings_panel = document.createElement("label")
    settings_panel.className = "desk_wbox_body_media_popup_panel"
    settings_panel.append("Playback speed", rate)
    settings.append(settings_panel)
    if (media instanceof HTMLVideoElement) {
        const captions = button("Subtitles", () => {
            const tracks = [...media.textTracks]
            const showing = tracks.some(track => track.mode === "showing")
            tracks.forEach((track, index) => { track.mode = !showing && index === 0 ? "showing" : "disabled" })
            captions.setAttribute("aria-pressed", String(!showing))
        })
        captions.disabled = media.textTracks.length === 0
        captions.title = captions.disabled ? "No subtitles available" : "Subtitles"
        captions.setAttribute("aria-pressed", "false")
        media.textTracks.addEventListener("addtrack", () => { captions.disabled = false; captions.title = "Subtitles" })
        tools.insertBefore(captions, settings)
        if (document.pictureInPictureEnabled) button("Picture in picture", () => {
            void (document.pictureInPictureElement ? document.exitPictureInPicture() : media.requestPictureInPicture()).catch(() => {})
        })
        const full = button("Fullscreen", fullscreen)
        full.className = "desk_wbox_body_media_tool_full"
        box.addEventListener("fullscreenchange", () => {
            const active = document.fullscreenElement === box
            button_icon(full, active ? "Exit fullscreen" : "Fullscreen")
            full.setAttribute("aria-pressed", String(active))
        })
        full.setAttribute("aria-pressed", "false")
    }
    const clock = (seconds: number): string => Number.isFinite(seconds) ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}` : "0:00"
    const update = (): void => {
        button_icon(play, media.paused ? "Play" : "Pause")
        button_icon(mute, media.muted || media.volume === 0 ? "Unmute" : "Mute")
        button_icon(volume_popup.firstElementChild as HTMLElement, media.muted || media.volume === 0 ? "Unmute" : "Mute")
        volume_popup.firstElementChild!.setAttribute("aria-label", "Volume controls")
        mute.setAttribute("aria-pressed", String(media.muted))
        seek.disabled = !Number.isFinite(media.duration) || media.duration <= 0
        seek.max = seek.disabled ? "0" : String(media.duration)
        seek.value = String(media.currentTime)
        volume.value = String(media.volume)
        current.textContent = clock(media.currentTime)
        duration.textContent = clock(media.duration)
        seek.setAttribute("aria-valuetext", `${clock(media.currentTime)} of ${clock(media.duration)}`)
        const progress = seek.disabled ? 0 : media.currentTime / media.duration * 100
        const buffered = seek.disabled || !media.buffered.length ? 0 : media.buffered.end(media.buffered.length - 1) / media.duration * 100
        seek.style.setProperty("--played", `${progress}%`)
        seek.style.setProperty("--buffered", `${buffered}%`)
        rate.value = String(media.playbackRate)
    }
    for (const event of ["loadedmetadata", "durationchange", "timeupdate", "progress", "play", "pause", "ended", "volumechange", "ratechange"]) media.addEventListener(event, update)
    media.addEventListener("error", failed, { once: true })
    update()
    box.append(media, head, timeline, tools)
    return box
}
