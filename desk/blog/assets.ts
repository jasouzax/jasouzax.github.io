/* Decode published, same-origin media once; preview and export share the immutable decoded assets. */
import type { Timeline } from "../../shared/blog/timeline.ts"
export type Assets = { images: Map<string, ImageBitmap>; audio: Map<string, AudioBuffer> }

async function decode_image(data: ArrayBuffer, svg: boolean, signal: AbortSignal): Promise<ImageBitmap> {
    if (!svg) return createImageBitmap(new Blob([data]))
    // Chromium cannot reliably decode SVG Blobs directly with createImageBitmap.
    const url = URL.createObjectURL(new Blob([data], { type: "image/svg+xml" }))
    const image = new Image()
    const abort = () => { image.src = "" }
    signal.addEventListener("abort", abort, { once: true })
    try {
        image.src = url
        await image.decode()
        signal.throwIfAborted()
        if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth > 8192 || image.naturalHeight > 8192) throw new Error("Invalid SVG image dimensions")
        const canvas = document.createElement("canvas")
        canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
        const context = canvas.getContext("2d")
        if (!context) throw new Error("Canvas is unavailable")
        context.drawImage(image, 0, 0)
        return await createImageBitmap(canvas)
    } finally {
        signal.removeEventListener("abort", abort)
        URL.revokeObjectURL(url)
    }
}

export async function prepare_assets(timeline: Timeline, signal: AbortSignal, with_audio = true): Promise<Assets> {
    const assets: Assets = { images: new Map(), audio: new Map() }
    let decoder: OfflineAudioContext | null = null
    const bytes = async (path: string): Promise<ArrayBuffer> => {
        const url = new URL(path, location.href)
        if (url.origin !== location.origin || !url.pathname.startsWith("/")) throw new Error("Only published same-origin media is supported")
        const response = await fetch(url, { signal, credentials: "same-origin" })
        if (!response.ok) throw new Error(`Media request failed (${response.status})`)
        const blob = await response.blob()
        if (blob.size > 64 * 1024 * 1024) throw new Error("Scene media exceeds 64 MiB")
        return blob.arrayBuffer()
    }
    try {
        for (const scene of timeline.segments) {
            signal.throwIfAborted()
            if (scene.image && !assets.images.has(scene.image)) {
                const data = await bytes(scene.image)
                assets.images.set(scene.image, await decode_image(data, /\.svg$/i.test(scene.image), signal))
            }
            if (with_audio && scene.audio && !assets.audio.has(scene.audio)) {
                decoder ??= new OfflineAudioContext(2, 1, 48000)
                assets.audio.set(scene.audio, await decoder.decodeAudioData(await bytes(scene.audio)))
            }
        }
        signal.throwIfAborted()
        return assets
    } catch (error) {
        release_assets(assets)
        throw error
    }
}

export function release_assets(assets: Assets): void {
    assets.images.forEach(image => image.close())
    assets.images.clear(); assets.audio.clear()
}

export async function mix_audio(timeline: Timeline, assets: Assets, signal: AbortSignal): Promise<AudioBuffer | null> {
    if (!assets.audio.size) return null
    signal.throwIfAborted()
    const context = new OfflineAudioContext(2, Math.ceil(timeline.duration * 48000), 48000)
    for (const scene of timeline.segments) {
        const buffer = scene.audio && assets.audio.get(scene.audio)
        if (!buffer) continue
        const source = context.createBufferSource()
        source.buffer = buffer; source.connect(context.destination)
        source.start(scene.start, 0, Math.min(scene.duration, buffer.duration))
    }
    const buffer = await context.startRendering()
    signal.throwIfAborted()
    return buffer
}
