// Expand rename tokens once, so text captured from an old name stays literal.
export function rename_pattern(pattern: string, previous: string, index: number): string {
    return pattern.replace(/\*\*|<([^>]*)>|(\d*)\*(?!\*)(\d*)/g, (token, filter: string | undefined, width: string, start: string) => {
        if (token === "**") return "*"
        if (filter !== undefined) return filter === "" ? previous : previous.match(new RegExp(filter))?.[0] ?? ""
        const digits = Number(width || 0)
        const number = Number(start || 0) + index
        if (digits > 255 || !Number.isSafeInteger(number)) throw new Error("Invalid rename counter")
        return String(number).padStart(digits, "0")
    })
}

export function available_name(name: string, occupied: ReadonlySet<string>): string {
    const dot = name.lastIndexOf(".")
    const stem = dot > 0 ? name.slice(0, dot) : name
    const ext = dot > 0 ? name.slice(dot) : ""
    let candidate = name
    for (let count = 1; occupied.has(candidate); count++) candidate = `${stem} (${count})${ext}`
    return candidate
}

export type zip_entry = { name: string, data: Uint8Array }

function crc32(data: Uint8Array): number {
    let crc = 0xffffffff
    for (const byte of data) {
        crc ^= byte
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
    return (crc ^ 0xffffffff) >>> 0
}

// A standard UTF-8 ZIP using stored entries, including explicit empty directories.
export function zip_blob(entries: zip_entry[]): Blob {
    if (entries.length > 65535) throw new Error("Too many ZIP entries")
    const parts: BlobPart[] = [], central: BlobPart[] = []
    let offset = 0, central_size = 0
    for (const entry of entries) {
        const name = new TextEncoder().encode(entry.name)
        if (name.length > 65535 || offset + entry.data.length + name.length + 30 > 0xffffffff) throw new Error("ZIP is too large")
        const crc = crc32(entry.data)
        const local = new Uint8Array(30), l = new DataView(local.buffer)
        l.setUint32(0, 0x04034b50, true)
        l.setUint16(4, 20, true)
        l.setUint16(6, 0x0800, true)
        l.setUint16(12, 33, true) // 1980-01-01
        l.setUint32(14, crc, true)
        l.setUint32(18, entry.data.length, true)
        l.setUint32(22, entry.data.length, true)
        l.setUint16(26, name.length, true)
        parts.push(local.buffer, name.buffer, new Uint8Array(entry.data).buffer)
        const header = new Uint8Array(46), h = new DataView(header.buffer)
        h.setUint32(0, 0x02014b50, true)
        h.setUint16(4, 20, true)
        h.setUint16(6, 20, true)
        h.setUint16(8, 0x0800, true)
        h.setUint16(14, 33, true)
        h.setUint32(16, crc, true)
        h.setUint32(20, entry.data.length, true)
        h.setUint32(24, entry.data.length, true)
        h.setUint16(28, name.length, true)
        h.setUint32(38, entry.name.endsWith("/") ? 0x10 : 0, true)
        h.setUint32(42, offset, true)
        central.push(header.buffer, name.buffer)
        offset += 30 + name.length + entry.data.length
        central_size += 46 + name.length
    }
    const end = new Uint8Array(22), e = new DataView(end.buffer)
    e.setUint32(0, 0x06054b50, true)
    e.setUint16(8, entries.length, true)
    e.setUint16(10, entries.length, true)
    e.setUint32(12, central_size, true)
    e.setUint32(16, offset, true)
    return new Blob([...parts, ...central, end.buffer], { type: "application/zip" })
}
