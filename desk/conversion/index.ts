import type { Converter } from "./graph.ts"
import { convert_image } from "./image_pdf.ts"
import { image_converters, image_sources, image_fields, encode_image } from "./image.ts"
import { pdf_converter } from "./pdf.ts"
import { table_converters } from "./table.ts"
export const converters: Converter[] = [...table_converters, pdf_converter, ...image_converters, ...image_sources.map(from => ({
    id: "image-pdf", from, to: "application/pdf", extension: "pdf", fields: image_fields, run: async (file: Blob, options: import("./graph.ts").Options, signal: AbortSignal) => convert_image(await encode_image(file, "image/jpeg", options, signal), signal),
}))]
