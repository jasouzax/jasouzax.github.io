import { brotliCompressSync, deflateSync } from "node:zlib"
import { outline_of, type outline } from "./outlines.ts"

export type font_job = {
    name: string, epoch: number, cell: number[], formats: string[], palettes: { light: string[], dark: string[] },
    syms: { codepoint: number, path: string, width: number | null, layers: { path: string, color: string }[] }[]
}
class writer {
    parts: Buffer[] = []
    u8(n: number) { const b = Buffer.alloc(1); b.writeUInt8(n); this.parts.push(b); return this }
    u16(n: number) { const b = Buffer.alloc(2); b.writeUInt16BE(n); this.parts.push(b); return this }
    i16(n: number) { const b = Buffer.alloc(2); b.writeInt16BE(n); this.parts.push(b); return this }
    u32(n: number) { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); this.parts.push(b); return this }
    bytes(b: Uint8Array) { this.parts.push(Buffer.from(b)); return this }
    zeros(n: number) { return this.bytes(Buffer.alloc(n)) }
    text(s: string) { return this.bytes(Buffer.from(s, "ascii")) }
    get buffer() { return Buffer.concat(this.parts) }
}
const padded = (buffer: Buffer) => Buffer.concat([buffer, Buffer.alloc((4 - buffer.length % 4) % 4)])
function checksum(buffer: Buffer): number {
    const bytes = padded(buffer); let sum = 0
    for (let i = 0; i < bytes.length; i += 4) sum = (sum + bytes.readUInt32BE(i)) >>> 0
    return sum
}
function glyph_data(glyph: outline): Buffer {
    if (!glyph.contours.length) return Buffer.alloc(0)
    const points = glyph.contours.flat()
    if (points.length > 65535) throw new Error("Glyph has too many points")
    const out = new writer().i16(glyph.contours.length)
    glyph.bounds.forEach(n => out.i16(n))
    let end = -1
    glyph.contours.forEach(contour => { end += contour.length; out.u16(end) })
    out.u16(0)
    points.forEach(() => out.u8(1))
    for (const axis of ["x", "y"] as const) {
        let previous = 0
        for (const point of points) { out.i16(point[axis] - previous); previous = point[axis] }
    }
    return padded(out.buffer)
}
function cmap_of(mapping: [number, number][]): Buffer {
    const sorted = [...mapping].sort((a, b) => a[0] - b[0])
    const groups = new writer().u16(12).u16(0).u32(16 + 12 * sorted.length).u32(0).u32(sorted.length)
    sorted.forEach(([code, id]) => groups.u32(code).u32(code).u32(id))
    const bmp = sorted.filter(([code]) => code < 0xffff)
    const count = bmp.length + 1, power = 2 ** Math.floor(Math.log2(count))
    const format4 = new writer().u16(4).u16(16 + count * 8).u16(0).u16(count * 2).u16(power * 2).u16(Math.log2(power)).u16(count * 2 - power * 2)
    bmp.forEach(([code]) => format4.u16(code)); format4.u16(0xffff).u16(0)
    bmp.forEach(([code]) => format4.u16(code)); format4.u16(0xffff)
    bmp.forEach(([code, id]) => format4.u16((id - code) & 0xffff)); format4.u16(1)
    for (let i = 0; i < count; i++) format4.u16(0)
    return new writer().u16(0).u16(2).u16(3).u16(1).u32(20).u16(3).u16(10).u32(20 + format4.buffer.length).bytes(format4.buffer).bytes(groups.buffer).buffer
}
function names_of(name: string): Buffer {
    const values = [[1, name], [2, "Regular"], [3, `JAZU:${name}:1`], [4, name], [5, "Version 1.000"], [6, name.replace(/[^a-zA-Z0-9_-]/g, "_")]] as const
    const header = new writer().u16(0).u16(values.length).u16(6 + 12 * values.length), strings = new writer()
    let offset = 0
    for (const [id, value] of values) {
        const text = Buffer.from(value, "utf16le"); text.swap16()
        header.u16(3).u16(1).u16(0x409).u16(id).u16(text.length).u16(offset)
        strings.bytes(text); offset += text.length
    }
    return Buffer.concat([header.buffer, strings.buffer])
}
function color(value: string): number[] {
    let hex = value.replace(/^#/, "")
    if (hex.length === 3) hex = [...hex].map(c => c + c).join("")
    if (!/^(?:[a-f\d]{6}|[a-f\d]{8})$/i.test(hex)) throw new Error(`Invalid palette color ${value}`)
    return [parseInt(hex.slice(4, 6), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(0, 2), 16), hex.length === 8 ? parseInt(hex.slice(6, 8), 16) : 255]
}
function tables_of(job: font_job, colored: boolean): Map<string, Buffer> {
    const [width, height] = job.cell
    if (!Number.isInteger(height) || height < 16 || height > 16384 || !Number.isInteger(width) || width < 1 || width > 65535) throw new Error("Font cell must have integer width and em height 16–16384")
    const glyphs: outline[] = [outline_of([], height)], widths: number[] = [width], mapping: [number, number][] = []
    const bases: { id: number, first: number, count: number }[] = [], layers: [number, number][] = []
    const palette = [...job.palettes.light]
    for (const sym of job.syms) {
        const id = glyphs.length
        mapping.push([sym.codepoint, id]); glyphs.push(outline_of(sym.layers.length ? sym.layers.map(layer => layer.path) : [sym.path], height)); widths.push(sym.width ?? width)
        if (colored && sym.layers.length) {
            bases.push({ id, first: layers.length, count: sym.layers.length })
            for (const layer of sym.layers) {
                let index: number
                if (/^\d+$/.test(layer.color)) index = Number(layer.color)
                else { index = palette.indexOf(layer.color); if (index < 0) { index = palette.length; palette.push(layer.color) } }
                if (index >= palette.length) throw new Error(`Palette index ${index} has no color`)
                layers.push([glyphs.length, index]); glyphs.push(outline_of([layer.path], height)); widths.push(sym.width ?? width)
            }
        }
    }
    if (glyphs.length > 65535) throw new Error("Font has too many glyphs")
    const tables = new Map<string, Buffer>(), glyf = new writer(), loca = new writer()
    let offset = 0
    for (const glyph of glyphs) { loca.u32(offset); const data = glyph_data(glyph); glyf.bytes(data); offset += data.length }
    loca.u32(offset); tables.set("glyf", glyf.buffer); tables.set("loca", loca.buffer)
    const bounds = [Math.min(...glyphs.map(g => g.bounds[0])), Math.min(...glyphs.map(g => g.bounds[1])), Math.max(...glyphs.map(g => g.bounds[2])), Math.max(...glyphs.map(g => g.bounds[3]))]
    const timestamp = BigInt(job.epoch + 2082844800), time = Buffer.alloc(8); time.writeBigUInt64BE(timestamp)
    const head = new writer().u32(0x10000).u32(0x10000).u32(0).u32(0x5f0f3cf5).u16(3).u16(height).bytes(time).bytes(time)
    bounds.forEach(n => head.i16(n)); head.u16(0).u16(8).i16(2).i16(1).i16(0); tables.set("head", head.buffer)
    const hhea = new writer().u32(0x10000).i16(height).i16(0).i16(0).u16(Math.max(...widths)).i16(Math.min(...glyphs.map(g => g.bounds[0]))).i16(Math.min(...glyphs.map((g, i) => widths[i] - g.bounds[2]))).i16(Math.max(...glyphs.map(g => g.bounds[2]))).i16(1).i16(0).i16(0).zeros(8).i16(0).u16(glyphs.length)
    tables.set("hhea", hhea.buffer)
    const hmtx = new writer(); glyphs.forEach((g, i) => hmtx.u16(widths[i]).i16(g.bounds[0])); tables.set("hmtx", hmtx.buffer)
    const maxp = new writer().u32(0x10000).u16(glyphs.length).u16(Math.max(...glyphs.map(g => g.contours.flat().length))).u16(Math.max(...glyphs.map(g => g.contours.length))).u16(0).u16(0).u16(2).zeros(16)
    tables.set("maxp", maxp.buffer); tables.set("cmap", cmap_of(mapping)); tables.set("name", names_of(job.name))
    tables.set("post", new writer().u32(0x30000).u32(0).i16(-Math.round(height / 10)).i16(Math.max(1, Math.round(height / 20))).u32(widths.every(w => w === width) ? 1 : 0).zeros(16).buffer)
    const codes = mapping.map(([code]) => code), bmp = codes.filter(code => code <= 0xffff)
    const os2 = new writer().u16(4).i16(Math.round(widths.reduce((a, b) => a + b, 0) / widths.length)).u16(400).u16(5).u16(0).zeros(22).zeros(10).u32(1).u32(codes.some(code => code > 0xffff) ? 1 << 25 : 0).u32(0).u32(0).text("JAZU").u16(0x40).u16(bmp.length ? Math.min(...bmp) : 0xffff).u16(codes.some(code => code > 0xffff) ? 0xffff : bmp.length ? Math.max(...bmp) : 0).i16(height).i16(0).i16(0).u16(Math.max(height, bounds[3])).u16(Math.max(0, -bounds[1])).zeros(8).i16(Math.round(height / 2)).i16(height).u16(0).u16(32).u16(0)
    tables.set("OS/2", os2.buffer)
    if (colored && bases.length) {
        const colr = new writer().u16(0).u16(bases.length).u32(14).u32(14 + bases.length * 6).u16(layers.length)
        bases.forEach(base => colr.u16(base.id).u16(base.first).u16(base.count)); layers.forEach(([id, index]) => colr.u16(id).u16(index)); tables.set("COLR", colr.buffer)
        const palettes = [palette, ...(job.palettes.dark.length ? [palette.map((fallback, i) => job.palettes.dark[i] ?? fallback)] : [])]
        const cpal = new writer().u16(0).u16(palette.length).u16(palettes.length).u16(palette.length * palettes.length).u32(12 + palettes.length * 2)
        palettes.forEach((_, i) => cpal.u16(i * palette.length)); palettes.flat().forEach(value => color(value).forEach(c => cpal.u8(c))); tables.set("CPAL", cpal.buffer)
    }
    return new Map([...tables].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
}
function sfnt(tables: Map<string, Buffer>): Buffer {
    const count = tables.size, power = 2 ** Math.floor(Math.log2(count)), header = new writer().u32(0x10000).u16(count).u16(power * 16).u16(Math.log2(power)).u16(count * 16 - power * 16)
    let offset = 12 + count * 16, head_offset = 0
    const parts: Buffer[] = []
    for (const [tag, bytes] of tables) {
        header.text(tag).u32(checksum(bytes)).u32(offset).u32(bytes.length)
        if (tag === "head") head_offset = offset
        const data = padded(bytes); parts.push(data); offset += data.length
    }
    const font = Buffer.concat([header.buffer, ...parts]), adjustment = (0xb1b0afba - checksum(font)) >>> 0
    font.writeUInt32BE(adjustment, head_offset + 8); tables.get("head")!.writeUInt32BE(adjustment, 8)
    return font
}
function woff(tables: Map<string, Buffer>, ttf_size: number): Buffer {
    let offset = 44 + 20 * tables.size
    const directory = new writer(), body: Buffer[] = []
    for (const [tag, bytes] of tables) {
        const compressed = deflateSync(bytes), data = compressed.length < bytes.length ? compressed : bytes
        const check = Buffer.from(bytes); if (tag === "head") check.writeUInt32BE(0, 8)
        directory.text(tag).u32(offset).u32(data.length).u32(bytes.length).u32(checksum(check)); body.push(padded(data)); offset += padded(data).length
    }
    return new writer().text("wOFF").u32(0x10000).u32(offset).u16(tables.size).u16(0).u32(ttf_size).u16(1).u16(0).zeros(20).bytes(directory.buffer).bytes(Buffer.concat(body)).buffer
}
const tags = ["cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf", "loca", "prep", "CFF ", "VORG", "EBDT", "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC", "JSTF", "MATH", "CBDT", "CBLC", "COLR", "CPAL"]
function base128(n: number): Buffer { const values = [n & 127]; while (n >>>= 7) values.unshift((n & 127) | 128); return Buffer.from(values) }
function woff2(tables: Map<string, Buffer>, ttf_size: number): Buffer {
    const directory = new writer()
    for (const [tag, bytes] of tables) {
        const index = tags.indexOf(tag), transform = tag === "glyf" || tag === "loca" ? 3 : 0
        directory.u8((transform << 6) | (index < 0 ? 63 : index)); if (index < 0) directory.text(tag)
        directory.bytes(base128(bytes.length))
    }
    const data = brotliCompressSync(Buffer.concat([...tables.values()]))
    return new writer().text("wOF2").u32(0x10000).u32(48 + directory.buffer.length + data.length).u16(tables.size).u16(0).u32(ttf_size).u32(data.length).u16(1).u16(0).zeros(20).bytes(directory.buffer).bytes(data).buffer
}
export function encode_font(job: font_job): Map<string, Buffer> {
    const output = new Map<string, Buffer>()
    for (const format of job.formats) {
        if (!["ttf", "woff", "woff2", "colrv0"].includes(format)) throw new Error(`Font format ${format} is not implemented`)
        const tables = tables_of(job, format === "colrv0"), ttf = sfnt(tables)
        output.set(format, format === "ttf" ? ttf : format === "woff" ? woff(tables, ttf.length) : woff2(tables, ttf.length))
    }
    return output
}
