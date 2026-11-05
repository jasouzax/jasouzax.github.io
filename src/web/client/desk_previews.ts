import { token_map } from "./desk_syntax.ts"

const width = 320, height = 200
const version = "folder-previews-1-320x200"
export const preview_cache_path = "/home/user/.cache/previews"
export type preview_result = { blob: Blob, source: "cache" | "generated" | "temporary" }
const pending = new Map<string, Promise<preview_result>>()
let writes = 0
let trimming: Promise<void> | null = null

export async function preview_key(path: string, file: File, mime: string): Promise<string> {
    const metadata = new TextEncoder().encode(JSON.stringify([version, path, file.size, file.lastModified, mime]))
    const sample = new Uint8Array(await file.slice(0, 65536).arrayBuffer())
    const bytes = new Uint8Array(metadata.length + sample.length)
    bytes.set(metadata); bytes.set(sample, metadata.length)
    return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(byte => byte.toString(16).padStart(2, "0")).join("")
}

async function cache_directory(): Promise<FileSystemDirectoryHandle | null> {
    try {
        const root = await navigator.storage.getDirectory()
        const cache = await root.getDirectoryHandle(".cache", { create: true })
        return await cache.getDirectoryHandle("previews", { create: true })
    } catch { return null }
}

async function trim_cache(dir: FileSystemDirectoryHandle): Promise<void> {
    const files: { name: string, modified: number }[] = []
    for await (const entry of dir.values()) if (entry.kind === "file" && /^[a-f0-9]{64}\.png$/.test(entry.name)) {
        files.push({ name: entry.name, modified: (await entry.getFile()).lastModified })
    }
    files.sort((a, b) => b.modified - a.modified)
    for (const file of files.slice(256)) await dir.removeEntry(file.name)
}

function canvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
    const element = document.createElement("canvas")
    element.width = width; element.height = height
    const ctx = element.getContext("2d")!
    ctx.fillStyle = "#05121b"; ctx.fillRect(0, 0, width, height)
    return [element, ctx]
}

function fit(ctx: CanvasRenderingContext2D, source: CanvasImageSource, w: number, h: number): void {
    const scale = Math.min(width / Math.max(1, w), height / Math.max(1, h))
    ctx.drawImage(source, (width - w * scale) / 2, (height - h * scale) / 2, w * scale, h * scale)
}

function wait_for(element: HTMLMediaElement, event: string, ready: () => boolean): Promise<void> {
    if (ready()) return Promise.resolve()
    return new Promise((resolve, reject) => {
        const clean = () => { clearTimeout(timer); element.removeEventListener(event, done); element.removeEventListener("error", fail) }
        const done = () => { clean(); resolve() }
        const fail = () => { clean(); reject(new Error("Media preview unavailable")) }
        const timer = setTimeout(fail, 8000)
        element.addEventListener(event, done, { once: true })
        element.addEventListener("error", fail, { once: true })
    })
}

async function image_preview(ctx: CanvasRenderingContext2D, file: File): Promise<void> {
    const url = URL.createObjectURL(file)
    try {
        const image = new Image()
        image.src = url
        await image.decode()
        fit(ctx, image, image.naturalWidth, image.naturalHeight)
    } finally { URL.revokeObjectURL(url) }
}

async function video_preview(ctx: CanvasRenderingContext2D, file: File): Promise<void> {
    const video = document.createElement("video")
    const url = URL.createObjectURL(file)
    video.muted = true; video.playsInline = true; video.preload = "auto"
    try {
        video.src = url
        await wait_for(video, "loadeddata", () => video.readyState >= 2)
        if (Number.isFinite(video.duration) && video.duration > .2) {
            video.currentTime = Math.min(1, video.duration / 4)
            await wait_for(video, "seeked", () => !video.seeking && video.readyState >= 2)
        }
        fit(ctx, video, video.videoWidth, video.videoHeight)
        ctx.fillStyle = "#ffffffcc"
        ctx.beginPath(); ctx.moveTo(145, 80); ctx.lineTo(145, 120); ctx.lineTo(180, 100); ctx.closePath(); ctx.fill()
    } finally {
        video.pause(); video.removeAttribute("src"); video.load()
        URL.revokeObjectURL(url)
    }
}

function file_card(ctx: CanvasRenderingContext2D, file: File, mime: string): void {
    ctx.fillStyle = "#7ee7f7"; ctx.font = "bold 32px monospace"
    ctx.fillText((file.name.split(".").pop() || "FILE").slice(0, 10).toUpperCase(), 24, 76)
    ctx.fillStyle = "#ffffff"; ctx.font = "14px monospace"
    ctx.fillText(file.name.slice(0, 31), 24, 116)
    ctx.fillStyle = "#9db2c7"; ctx.font = "12px monospace"
    ctx.fillText(mime.slice(0, 36), 24, 146)
    ctx.fillText(`${file.size.toLocaleString()} bytes`, 24, 168)
}

async function code_preview(ctx: CanvasRenderingContext2D, file: File, mime: string): Promise<void> {
    const source = (await file.slice(0, 16000).text()).replace(/\r\n/g, "\n")
    if (source.includes("\0")) { file_card(ctx, file, mime); return }
    ctx.fillStyle = "#132632"; ctx.fillRect(0, 0, width, 29)
    ctx.fillStyle = "#7ee7f7"; ctx.font = "12px monospace"; ctx.fillText(file.name.slice(0, 40), 12, 19)
    const map = token_map(source, mime)
    const colors = ["#e6f1fb", "#86a78b", "#efbd85", "#7ee7cb", "#cda8ff", "#82bfff", "#e9d28e", "#8cd8ff", "#f09fc3", "#8fc1f1", "#f09fc3", "#a5b4c2"]
    let offset = 0
    for (const [index, line] of source.split("\n").slice(0, 10).entries()) {
        const y = 45 + index * 15
        ctx.fillStyle = "#718799"; ctx.fillText(String(index + 1), 8, y)
        let column = 0
        for (let i = 0; i < line.length && column < 39; i++) {
            if (line[i] === "\t") { column += 4 - column % 4; continue }
            ctx.fillStyle = colors[map?.[offset + i] ?? 0]
            ctx.fillText(line[i], 34 + column * 7.2, y)
            column++
        }
        offset += line.length + 1
    }
}

async function make_preview(file: File, mime: string): Promise<Blob> {
    const [element, ctx] = canvas()
    try {
        if (mime.startsWith("image/")) await image_preview(ctx, file)
        else if (mime.startsWith("video/")) await video_preview(ctx, file)
        else if (mime.startsWith("text/") || /json|javascript|typescript|xml|yaml|sql|x-sh/.test(mime)) await code_preview(ctx, file, mime)
        else file_card(ctx, file, mime)
    } catch { ctx.fillStyle = "#05121b"; ctx.fillRect(0, 0, width, height); file_card(ctx, file, mime) }
    return new Promise((resolve, reject) => element.toBlob(blob => blob ? resolve(blob) : reject(new Error("Preview unavailable")), "image/png"))
}

export async function file_preview(path: string, file: File, mime: string): Promise<preview_result> {
    // Browsing the cache itself must not create previews of previews.
    if (path.startsWith("/home/user/.cache/")) return { blob: mime.startsWith("image/") ? file : await make_preview(file, mime), source: "temporary" }
    const key = await preview_key(path, file, mime)
    const existing = pending.get(key)
    if (existing) return existing
    const work = (async (): Promise<preview_result> => {
        const dir = await cache_directory()
        if (dir) try {
            const file = await (await dir.getFileHandle(`${key}.png`)).getFile()
            const signature = [...new Uint8Array(await file.slice(0, 8).arrayBuffer())].join(",")
            if (signature === "137,80,78,71,13,10,26,10") return { blob: file, source: "cache" }
        } catch { /* a missing or damaged thumbnail is generated again */ }
        const blob = await make_preview(file, mime)
        if (dir) try {
            const writer = await (await dir.getFileHandle(`${key}.png`, { create: true })).createWritable()
            await writer.write(blob); await writer.close()
            if (++writes % 32 === 0 && !trimming) {
                trimming = trim_cache(dir).catch(() => {}).finally(() => { trimming = null })
            }
            return { blob, source: "generated" }
        } catch { /* storage may be unavailable or full; tiles can still be shown */ }
        return { blob, source: "temporary" }
    })()
    pending.set(key, work)
    try { return await work } finally { pending.delete(key) }
}
