// A small file detector: what a file most likely is, best guess first. It looks at the type the browser reported, the extension and the
// first bytes (magic numbers), and finally whether the bytes read as text. The window's type list shows these first; the list's search can
// pick any other type, or take one that is typed in.

import { state } from "./desk.ts"

const magic: { mime: string, bytes: (number | null)[], at?: number }[] = [
    { mime: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
    { mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
    { mime: "image/gif", bytes: [0x47, 0x49, 0x46, 0x38] },
    { mime: "image/webp", bytes: [0x52, 0x49, 0x46, 0x46, null, null, null, null, 0x57, 0x45, 0x42, 0x50] },
    { mime: "image/bmp", bytes: [0x42, 0x4d] },
    { mime: "image/x-icon", bytes: [0x00, 0x00, 0x01, 0x00] },
    { mime: "image/avif", bytes: [0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66], at: 4 },
    { mime: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46] },
    { mime: "application/zip", bytes: [0x50, 0x4b, 0x03, 0x04] },
    { mime: "audio/mpeg", bytes: [0x49, 0x44, 0x33] },
    { mime: "audio/mpeg", bytes: [0xff, 0xfb] },
    { mime: "audio/ogg", bytes: [0x4f, 0x67, 0x67, 0x53] },
    { mime: "audio/flac", bytes: [0x66, 0x4c, 0x61, 0x43] },
    { mime: "audio/wav", bytes: [0x52, 0x49, 0x46, 0x46, null, null, null, null, 0x57, 0x41, 0x56, 0x45] },
    { mime: "video/webm", bytes: [0x1a, 0x45, 0xdf, 0xa3] },
    { mime: "video/mp4", bytes: [0x66, 0x74, 0x79, 0x70], at: 4 },
]

function matches(head: Uint8Array, entry: (typeof magic)[number]): boolean {
    const at = entry.at ?? 0
    return entry.bytes.every((byte, index) => byte === null || head[at + index] === byte)
}

// Text if the head decodes as UTF-8 with no control characters other than the usual whitespace.
export function looks_like_text(head: Uint8Array): boolean {
    if (head.length === 0) return true
    let decoded: string
    try {
        decoded = new TextDecoder("utf-8", { fatal: true }).decode(head)
    } catch {
        // the head may end inside a multi-byte character
        try {
            decoded = new TextDecoder("utf-8", { fatal: true }).decode(head.subarray(0, Math.max(0, head.length - 3)))
        } catch {
            return false
        }
    }
    return !/[\u0000-\u0008\u000e-\u001f\u007f]/.test(decoded)
}

function by_extension(name: string): string {
    const extension = name.includes(".") ? (name.split(".").pop() ?? "").toLowerCase() : ""
    return extension ? (state.data?.mimes.find(info => info.extensions.includes(extension))?.mime ?? "") : ""
}

function svg_like(head: Uint8Array): boolean {
    return /<svg[\s>]/i.test(new TextDecoder().decode(head))
}

export async function detect_mimes(file: Blob, name: string): Promise<string[]> {
    const head = new Uint8Array(await file.slice(0, 512).arrayBuffer())
    const found: string[] = []
    const add = (mime: string): void => {
        if (mime && !found.includes(mime)) found.push(mime)
    }
    const named = by_extension(name)
    const sniffed = magic.filter(entry => matches(head, entry)).map(entry => entry.mime)
    const text = looks_like_text(head)
    // a name and a content that agree is the likeliest; then the content (a renamed file), the reported type, the name alone
    if (named && sniffed.includes(named)) add(named)
    for (const mime of sniffed) add(mime)
    if (text && svg_like(head)) add("image/svg+xml")
    if (file.type && file.type !== "application/octet-stream") add(file.type)
    add(named)
    if (text) {
        add("text/plain")
        if (/^\s*[{[]/.test(new TextDecoder().decode(head))) add("application/json")
    }
    add("application/octet-stream")
    // an mp4 container is also what audio/mp4 and quicktime start with
    if (found.includes("video/mp4") && /\.(m4a|aac)$/i.test(name)) found.unshift("audio/mp4")
    return found
}

export function mime_matches(query: string): { mime: string, label: string, icon: string }[] {
    const words = query.toLowerCase().split(/\s+/).filter(word => word.length > 0)
    const list = state.data?.mimes ?? []
    return list.filter(info => words.every(word => `${info.mime} ${info.label} ${info.extensions.join(" ")}`.toLowerCase().includes(word)))
}

export function is_mime(value: string): boolean {
    return /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(value.trim())
}
