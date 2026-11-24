import type { Converter } from "./graph.ts"
import { convert_image } from "./image_pdf.ts"
export const converters: Converter[] = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/bmp", "image/avif"].map(from => ({
    id: "image-pdf", from, to: "application/pdf", extension: "pdf", run: (file, _options, signal) => convert_image(file, signal),
}))
