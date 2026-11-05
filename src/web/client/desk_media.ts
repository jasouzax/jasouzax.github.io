import type { desk_window } from "./desk.ts"

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
        node.textContent = label
        node.title = label
        node.setAttribute("aria-label", label)
        node.addEventListener("click", action)
        tools.append(node)
        return node
    }
    const fullscreen = (): void => {
        void (document.fullscreenElement ? document.exitFullscreen() : box.requestFullscreen()).catch(() => {})
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
    const mute = button("Mute", () => { media.muted = !media.muted })
    const volume = document.createElement("input")
    volume.type = "range"
    volume.min = "0"; volume.max = "1"; volume.step = "0.01"; volume.value = "1"
    volume.setAttribute("aria-label", "Volume")
    volume.addEventListener("input", () => { media.volume = Number(volume.value); media.muted = false })
    tools.append(volume)
    const time = document.createElement("span")
    time.className = "desk_wbox_body_media_tool_time"
    tools.append(time)
    const rate = document.createElement("select")
    rate.setAttribute("aria-label", "Playback speed")
    for (const value of [.25, .5, 1, 1.5, 2]) {
        const option = document.createElement("option")
        option.value = String(value); option.textContent = `${value}×`; option.selected = value === 1
        rate.append(option)
    }
    rate.addEventListener("change", () => { media.playbackRate = Number(rate.value) })
    tools.append(rate)
    if (media instanceof HTMLVideoElement) {
        button("Fullscreen", fullscreen)
        if (document.pictureInPictureEnabled) button("Picture in picture", () => {
            void (document.pictureInPictureElement ? document.exitPictureInPicture() : media.requestPictureInPicture()).catch(() => {})
        })
    }
    const clock = (seconds: number): string => Number.isFinite(seconds) ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}` : "0:00"
    const update = (): void => {
        play.textContent = media.paused ? "Play" : "Pause"
        play.setAttribute("aria-label", play.textContent)
        mute.setAttribute("aria-pressed", String(media.muted))
        seek.disabled = !Number.isFinite(media.duration) || media.duration <= 0
        seek.max = seek.disabled ? "0" : String(media.duration)
        seek.value = String(media.currentTime)
        volume.value = String(media.volume)
        time.textContent = `${clock(media.currentTime)} / ${clock(media.duration)}`
    }
    for (const event of ["loadedmetadata", "durationchange", "timeupdate", "play", "pause", "ended", "volumechange"]) media.addEventListener(event, update)
    media.addEventListener("error", failed, { once: true })
    update()
    box.append(media, head, timeline, tools)
    return box
}
