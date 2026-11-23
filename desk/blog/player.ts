/* Scene preview owns its animation/audio lifecycle; export gets a separate canvas and cancellation signal. */
import type { Timeline } from "../../shared/blog/timeline.ts"
import { blog_labels } from "../../shared/blog/text.ts"
import { prepare_assets, release_assets, type Assets } from "./assets.ts"
import { render_frame } from "./canvas.ts"
import { render_video } from "./export.ts"

function abortable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
    signal.throwIfAborted()
    return new Promise((resolve, reject) => {
        const abort = () => reject(signal.reason)
        signal.addEventListener("abort", abort, { once: true })
        pending.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort))
    })
}

function mount(panel: HTMLElement): () => void {
    const timeline = JSON.parse(panel.querySelector("[data-blog-timeline]")!.textContent!) as Timeline & { text: Record<string, string> }
    const canvas = panel.querySelector("canvas")!, context = canvas.getContext("2d")!
    const play = panel.querySelector<HTMLButtonElement>("[data-blog-play]")!
    const seek = panel.querySelector<HTMLInputElement>("[data-blog-seek]")!
    const render = panel.querySelector<HTMLButtonElement>("[data-blog-render]")!
    const cancel = panel.querySelector<HTMLButtonElement>("[data-blog-cancel]")!
    const status = panel.querySelector<HTMLOutputElement>("[data-blog-status]")!
    const labels = { ...blog_labels.en, ...timeline.text }
    const lifetime = new AbortController()
    let exporting: AbortController | null = null, assets: Assets = { images: new Map(), audio: new Map() }
    let prepared: Promise<Assets> | null = null, audio: AudioContext | null = null
    let sources: AudioBufferSourceNode[] = [], frame = 0, playing = false, position = 0, started = 0
    const ready = () => prepared ??= prepare_assets(timeline, lifetime.signal).then(result => {
        if (lifetime.signal.aborted) { release_assets(result); lifetime.signal.throwIfAborted() }
        release_assets(assets)
        assets = result
        return result
    }).catch(error => { prepared = null; throw error })
    const stop_audio = () => { sources.forEach(source => { try { source.stop() } catch {} }); sources = [] }
    const paint = () => { seek.value = String(position); render_frame(context, timeline, assets, position) }
    const stop = () => {
        playing = false; cancelAnimationFrame(frame); stop_audio(); play.textContent = labels.blog_play
    }
    const schedule_audio = () => {
        stop_audio()
        if (!audio) return
        for (const scene of timeline.segments) {
            const buffer = scene.audio && assets.audio.get(scene.audio)
            if (!buffer || scene.end <= position) continue
            const offset = Math.max(0, position - scene.start)
            const duration = Math.min(scene.duration, buffer.duration) - offset
            if (duration <= 0) continue
            const source = audio.createBufferSource()
            source.buffer = buffer; source.connect(audio.destination)
            source.start(audio.currentTime + Math.max(0, scene.start - position), offset, duration)
            sources.push(source)
        }
    }
    const tick = (now: number) => {
        if (!playing) return
        position = Math.min(timeline.duration, (now - started) / 1000)
        paint()
        if (position >= timeline.duration) stop()
        else frame = requestAnimationFrame(tick)
    }
    play.addEventListener("click", () => {
        if (playing) { stop(); return }
        if (position >= timeline.duration) position = 0
        // Resume during the click gesture, before asynchronous decoding loses user activation.
        if (timeline.segments.some(scene => scene.audio)) audio ??= new AudioContext()
        const resumed = audio?.resume() ?? Promise.resolve()
        play.disabled = true
        void Promise.all([ready(), resumed]).then(() => {
            if (lifetime.signal.aborted) return
            playing = true; started = performance.now() - position * 1000
            play.textContent = labels.blog_pause; status.textContent = ""
            schedule_audio(); frame = requestAnimationFrame(tick)
        }).catch(error => { if (!lifetime.signal.aborted) status.textContent = `${labels.blog_failed}: ${String(error.message || error)}` })
            .finally(() => { play.disabled = false })
    })
    seek.addEventListener("input", () => {
        position = Number(seek.value); started = performance.now() - position * 1000
        paint(); if (playing) schedule_audio()
    })
    cancel.addEventListener("click", () => exporting?.abort())
    render.addEventListener("click", () => {
        if (exporting) return
        if (!globalThis.VideoEncoder || !isSecureContext) { status.textContent = labels.blog_unsupported; return }
        stop(); exporting = new AbortController()
        const signal = AbortSignal.any([exporting.signal, lifetime.signal])
        render.disabled = true; play.disabled = true; seek.disabled = true; cancel.hidden = false
        status.textContent = labels.blog_preparing
        void (async () => {
            const decoded = await abortable(ready(), signal)
            const blob = await render_video(timeline, decoded, { signal, progress: value => { status.textContent = `${labels.blog_rendering} ${Math.round(value * 100)}%` } })
            signal.throwIfAborted()
            const url = URL.createObjectURL(blob), link = document.createElement("a")
            link.href = url; link.download = `${timeline.title.replace(/[^\p{L}\p{N}_-]+/gu, "-").slice(0, 100) || "blog"}.webm`
            link.click(); setTimeout(() => URL.revokeObjectURL(url), 60_000)
            status.textContent = labels.blog_done
        })().catch(error => {
            if (!lifetime.signal.aborted) status.textContent = signal.aborted ? labels.blog_cancelled : `${labels.blog_failed}: ${String(error.message || error)}`
        }).finally(() => {
            exporting = null; render.disabled = false; play.disabled = false; seek.disabled = false; cancel.hidden = true
        })
    })
    paint()
    // Initial stills need images, but audio/large media stays lazy until playback/export.
    const stills = { ...timeline, segments: timeline.segments.map(scene => ({ ...scene, audio: undefined })) }
    void prepare_assets(stills, lifetime.signal, false).then(result => {
        if (lifetime.signal.aborted || prepared) { release_assets(result); return }
        release_assets(assets); assets = result; paint()
    }).catch(error => { if (!lifetime.signal.aborted) status.textContent = `${labels.blog_failed}: ${String(error.message || error)}` })
    return () => { lifetime.abort(); exporting?.abort(); stop(); release_assets(assets); void audio?.close() }
}

export function init_blog_media(): void {
    let dispose: (() => void)[] = []
    const init = () => {
        dispose.forEach(cleanup => cleanup()); dispose = []
        for (const panel of document.querySelectorAll<HTMLElement>(".blog_media")) dispose.push(mount(panel))
    }
    document.addEventListener("jazu:page", init)
    init()
}
