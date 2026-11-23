/* Offline, backpressured WebCodecs encoding: no real-time screen recording or frame dropping. */
import { Output, WebMOutputFormat, BufferTarget, CanvasSource, AudioBufferSource, Quality } from "mediabunny"
import type { Timeline } from "../../shared/blog/timeline.ts"
import { render_frame } from "./canvas.ts"
import { mix_audio, type Assets } from "./assets.ts"

export async function render_video(timeline: Timeline, assets: Assets, options: {
    signal: AbortSignal; progress: (fraction: number) => void
    width?: number; height?: number; fps?: number
}): Promise<Blob> {
    if (!globalThis.VideoEncoder || !globalThis.VideoFrame || !isSecureContext) throw new Error("WebCodecs is unavailable")
    const width = options.width ?? 1920, height = options.height ?? 1080, fps = options.fps ?? 30
    if (![width, height, fps].every(value => Number.isInteger(value) && value > 0) || width > 3840 || height > 2160 || fps > 60 || !timeline.duration) throw new Error("Invalid video dimensions, frame rate or duration")
    options.signal.throwIfAborted()
    const canvas = document.createElement("canvas")
    canvas.width = width; canvas.height = height
    const context = canvas.getContext("2d")
    if (!context) throw new Error("Canvas is unavailable")
    const output = new Output({ format: new WebMOutputFormat(), target: new BufferTarget() })
    const video = new CanvasSource(canvas, { codec: "vp9", quality: new Quality({ bitrate: 6_000_000 }) })
    output.addVideoTrack(video, { frameRate: fps })
    const abort = () => { void output.cancel().catch(() => {}) }
    options.signal.addEventListener("abort", abort, { once: true })
    try {
        const mixed = await mix_audio(timeline, assets, options.signal)
        const audio = mixed ? new AudioBufferSource({ codec: "opus", quality: new Quality({ bitrate: 128_000 }) }) : null
        if (audio) output.addAudioTrack(audio)
        await output.start()
        // Audio and video are supplied concurrently so the muxer can apply inter-track backpressure.
        const audio_done = audio && mixed ? audio.add(mixed) : Promise.resolve()
        // Attach a handler immediately; propagate a failed audio track before finalization.
        let audio_error: unknown
        const checked_audio = audio_done.catch(error => { audio_error = error })
        const frames = Math.ceil(timeline.duration * fps)
        for (let index = 0; index < frames; index++) {
            options.signal.throwIfAborted()
            if (audio_error) throw audio_error
            const time = index / fps
            render_frame(context, timeline, assets, time)
            await video.add(time, Math.min(1 / fps, timeline.duration - time), { keyFrame: index % (fps * 2) === 0 })
            options.progress((index + 1) / frames)
            if (index % 8 === 0) await new Promise(resolve => setTimeout(resolve, 0))
        }
        await checked_audio
        if (audio_error) throw audio_error
        options.signal.throwIfAborted()
        await output.finalize()
        return new Blob([output.target.buffer!], { type: "video/webm" })
    } catch (error) {
        if (output.state !== "canceled" && output.state !== "finalized") await output.cancel()
        throw error
    } finally {
        options.signal.removeEventListener("abort", abort)
    }
}
