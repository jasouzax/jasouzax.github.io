/** Local canvas encoders. Reject unsupported encoders rather than mislabelling PNG bytes. */
import type { Converter, Field, Options } from "./graph.ts"
export const image_fields: Field[] = [
    { key: "image_width", label: "Width (0 = automatic)", value: "0", type: "number", min: "0", max: "32767" },
    { key: "image_height", label: "Height (0 = automatic)", value: "0", type: "number", min: "0", max: "32767" },
    { key: "image_rotation", label: "Rotation (clockwise degrees)", value: "0", type: "number", step: "90" },
    { key: "image_quality", label: "JPEG/WebP quality (0–1)", value: "0.92", type: "number", min: "0", max: "1", step: "0.01" },
    { key: "image_background", label: "Background (CSS color, blank = transparent)", value: "" },
]
export const image_sources = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/bmp", "image/avif", "image/svg+xml", "image/x-icon"]
export function image_dimensions(width: number, height: number, options: Options): { width: number, height: number, rotation: number, quality: number } {
    let w = Number(options.image_width || 0), h = Number(options.image_height || 0)
    const rotation = Number(options.image_rotation || 0), quality = Number(options.image_quality ?? .92)
    if (![w, h].every(value => Number.isInteger(value) && value >= 0) || !Number.isInteger(rotation / 90) || !Number.isFinite(quality) || quality < 0 || quality > 1) throw new Error("Invalid image dimensions, rotation or quality")
    if (!w && !h) { w = width; h = height }
    else if (!w) w = Math.max(1, Math.round(width * h / height))
    else if (!h) h = Math.max(1, Math.round(height * w / width))
    if (w > 32767 || h > 32767 || w * h > 40_000_000) throw new Error("Image exceeds 40 megapixels or maximum dimensions")
    return { width: w, height: h, rotation: ((rotation % 360) + 360) % 360, quality }
}
export async function encode_image(file: Blob, mime: string, options: Options, signal: AbortSignal): Promise<Blob> {
    signal.throwIfAborted()
    const url = URL.createObjectURL(file), image = new Image()
    try {
        image.src = url; await image.decode(); signal.throwIfAborted()
        const size = image_dimensions(image.naturalWidth, image.naturalHeight, options), canvas = document.createElement("canvas")
        const swap = size.rotation === 90 || size.rotation === 270
        canvas.width = swap ? size.height : size.width; canvas.height = swap ? size.width : size.height
        const context = canvas.getContext("2d")
        if (!context) throw new Error("Canvas is unavailable")
        const background = options.image_background || (mime === "image/jpeg" ? "white" : "")
        if (background) {
            if (!CSS.supports("color", background)) throw new Error("Invalid background color")
            context.fillStyle = background; context.fillRect(0, 0, canvas.width, canvas.height)
        }
        context.translate(canvas.width / 2, canvas.height / 2); context.rotate(size.rotation * Math.PI / 180)
        context.drawImage(image, -size.width / 2, -size.height / 2, size.width, size.height)
        const output = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Image encoding failed")), mime, size.quality))
        signal.throwIfAborted()
        if (output.type !== mime) throw new Error(`This browser cannot encode ${mime}`)
        return output
    } finally { image.src = ""; URL.revokeObjectURL(url) }
}
export const image_converters: Converter[] = image_sources.flatMap(from => ["image/png", "image/jpeg", "image/webp"].map(to => ({
    id: `image-${to.split("/")[1]}`, from, to, extension: to === "image/jpeg" ? "jpg" : to.split("/")[1], fields: image_fields,
    run: (file, options, signal) => encode_image(file, to, options, signal),
})))
