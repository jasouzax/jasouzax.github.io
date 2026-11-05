// The only place that touches the native SVG renderer. It is imported lazily so `check`, `graph` and `watch` keep working
// on a machine where `npm install` has not fetched @resvg/resvg-js yet; only a real build needs it.
import { jazu_error } from "./diag.ts"

export async function svg_to_png(svg: string, width: number): Promise<Buffer> {
    let module: typeof import("@resvg/resvg-js")
    try {
        module = await import("@resvg/resvg-js")
    } catch {
        throw new jazu_error("generating icons and cover images needs @resvg/resvg-js (run npm install)", 2)
    }
    const image = new module.Resvg(svg, { fitTo: { mode: "width", value: width }, font: { loadSystemFonts: true } })
    return image.render().asPng()
}

// An .ico may carry PNG images directly (Vista and later, every browser). Entries are 16-byte records after a 6-byte header.
export function build_ico(images: { size: number, png: Buffer }[]): Buffer {
    const header = Buffer.alloc(6)
    header.writeUInt16LE(1, 2)
    header.writeUInt16LE(images.length, 4)
    const entries = Buffer.alloc(16 * images.length)
    let offset = header.length + entries.length
    images.forEach((image, index) => {
        const at = index * 16
        entries.writeUInt8(image.size >= 256 ? 0 : image.size, at)
        entries.writeUInt8(image.size >= 256 ? 0 : image.size, at + 1)
        entries.writeUInt16LE(1, at + 4)
        entries.writeUInt16LE(32, at + 6)
        entries.writeUInt32LE(image.png.length, at + 8)
        entries.writeUInt32LE(offset, at + 12)
        offset += image.png.length
    })
    return Buffer.concat([header, entries, ...images.map(image => image.png)])
}

// Width and height from a PNG's IHDR chunk, so og:image:width/height can be stated for a hand-made cover.
export function png_size(bytes: Buffer): { width: number, height: number } | null {
    if (bytes.length < 24 || bytes.readUInt32BE(0) !== 0x89504e47) return null
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}
