import { token_map, coloured_nodes } from "./desk_syntax.ts"

const width = 320, height = 200
const version = "folder-previews-3-dynamic-cards"
export const preview_cache_path = "/home/user/.cache/previews"
export type preview_card = { extension: string, name: string, mime: string, size: number }
export type preview_result = { blob: Blob, text?: string, card?: preview_card, source: "cache" | "generated" | "temporary" }
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
    for await (const entry of dir.values()) if (entry.kind === "file" && /^[a-f0-9]{64}\.(png|txt|json)$/.test(entry.name)) {
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

export function card_preview_node(card: preview_card): HTMLElement {
    const box = document.createElement("span")
    box.className = "desk_folder_card"; box.setAttribute("aria-hidden", "true")
    for (const [tag, value] of [["strong", card.extension], ["span", card.name], ["small", card.mime], ["small", `${card.size.toLocaleString()} bytes`]]) {
        const line = document.createElement(tag); line.textContent = value; box.append(line)
    }
    return box
}

export function is_text_preview(mime: string): boolean {
    return !mime.startsWith("image/") && (mime.startsWith("text/") || /json|javascript|typescript|xml|yaml|sql|x-sh/.test(mime))
}

// Retain only the visible excerpt, even when the source has extremely long lines.
export async function text_excerpt(file: Blob): Promise<string | null> {
    const reader = file.stream().getReader(), decoder = new TextDecoder()
    const lines = [""]
    let column = 0, carriage = false, binary = false
    const consume = (value: string): boolean => {
        for (const char of value) {
            if (char === "\0") { binary = true; return false }
            if (char === "\n" && carriage) { carriage = false; continue }
            carriage = char === "\r"
            if (char === "\n" || char === "\r") {
                if (lines.length === 10) return false
                lines.push(""); column = 0
            } else if (column < 39) {
                const value = char === "\t" ? " ".repeat(Math.min(39 - column, 4 - column % 4)) : char
                lines[lines.length - 1] += value; column += [...value].length
            }
        }
        return true
    }
    try {
        while (true) {
            const chunk = await reader.read()
            const value = decoder.decode(chunk.value, { stream: !chunk.done })
            // A NUL within the inspected content identifies binary data.
            if (!consume(value)) break
            if (chunk.done) break
        }
    } finally { await reader.cancel(); reader.releaseLock() }
    return binary ? null : lines.join("\n")
}

export function text_preview_node(value: string, mime: string): HTMLElement {
    const box = document.createElement("span")
    box.className = "desk_folder_text"; box.setAttribute("aria-hidden", "true")
    const map = token_map(value, mime)
    let offset = 0
    for (const [index, line] of value.split("\n").entries()) {
        const row = document.createElement("span"); row.className = "desk_folder_text_line"
        const number = document.createElement("span"); number.className = "desk_folder_text_number"; number.textContent = String(index + 1)
        const code = document.createElement("span")
        code.append(...(map ? coloured_nodes(value, map, offset, offset + line.length, false) : [document.createTextNode(line)]))
        row.append(number, code); box.append(row); offset += line.length + 1
    }
    return box
}

async function make_preview(file: File, mime: string): Promise<Blob> {
    const [element, ctx] = canvas()
    if (mime.startsWith("image/")) await image_preview(ctx, file)
    else await video_preview(ctx, file)
    return new Promise((resolve, reject) => element.toBlob(blob => blob ? resolve(blob) : reject(new Error("Preview unavailable")), "image/png"))
}

export async function file_preview(path: string, file: File, mime: string): Promise<preview_result> {
    const textual = is_text_preview(mime)
    const generate = async (): Promise<Omit<preview_result, "source">> => {
        const text = textual ? await text_excerpt(file) : null
        if (text !== null) return { blob: new Blob([text], { type: "text/plain" }), text }
        if (/^(image|video)\//.test(mime)) try { return { blob: await make_preview(file, mime) } } catch { /* unsupported media uses a themed file card */ }
        const card = { extension: (file.name.split(".").pop() || "FILE").slice(0, 10).toUpperCase(), name: file.name, mime, size: file.size }
        return { blob: new Blob([JSON.stringify(card)], { type: "application/json" }), card }
    }
    // Browsing the cache itself must not create previews of previews.
    if (path.startsWith("/home/user/.cache/")) return { ...(mime.startsWith("image/") ? { blob: file } : await generate()), source: "temporary" }
    const key = await preview_key(path, file, mime)
    const existing = pending.get(key)
    if (existing) return existing
    const work = (async (): Promise<preview_result> => {
        const dir = await cache_directory()
        if (dir) try {
            try {
                const cached = await (await dir.getFileHandle(`${key}.json`)).getFile()
                const card = cached.size <= 16384 ? JSON.parse(await cached.text()) as preview_card : null
                if (card && typeof card.extension === "string" && card.name === file.name && card.mime === mime && card.size === file.size) return { blob: cached, card, source: "cache" }
            } catch { /* the preview may be text or raster media */ }
            if (textual) {
                try {
                    const cached = await (await dir.getFileHandle(`${key}.txt`)).getFile()
                    if (cached.size <= 1600) {
                        const text = await cached.text()
                        if (!text.includes("\0") && text.split("\n").length <= 10 && text.split("\n").every(line => [...line].length <= 39)) return { blob: cached, text, source: "cache" }
                    }
                } catch { /* a text-labelled binary file may have a raster fallback */ }
            }
            const image = await (await dir.getFileHandle(`${key}.png`)).getFile()
            const signature = [...new Uint8Array(await image.slice(0, 8).arrayBuffer())].join(",")
            if (signature === "137,80,78,71,13,10,26,10") return { blob: image, source: "cache" }
        } catch { /* a missing or damaged thumbnail is generated again */ }
        const result = await generate()
        if (dir) try {
            const writer = await (await dir.getFileHandle(`${key}.${result.text !== undefined ? "txt" : result.card ? "json" : "png"}`, { create: true })).createWritable()
            await writer.write(result.blob); await writer.close()
            if (++writes % 32 === 0 && !trimming) {
                trimming = trim_cache(dir).catch(() => {}).finally(() => { trimming = null })
            }
            return { ...result, source: "generated" }
        } catch { /* storage may be unavailable or full; tiles can still be shown */ }
        return { ...result, source: "temporary" }
    })()
    pending.set(key, work)
    try { return await work } finally { pending.delete(key) }
}
