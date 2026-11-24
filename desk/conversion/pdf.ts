/** Page extraction keeps native PDF page content, without rasterizing text or vectors. */
import type { Converter, Options } from "./graph.ts"
type Library = typeof import("pdf-lib")
let library: Promise<Library> | undefined
export function load_pdf_tools(): Promise<Library> {
    return library ??= fetch("/assets/pdf-tools.json").then(async response => {
        if (!response.ok) throw new Error("PDF tools unavailable")
        const assets = await response.json()
        return import(assets.module) as Promise<Library>
    }).catch(error => { library = undefined; throw error })
}
export function page_indices(value: string, count: number): number[] {
    if (!value.trim()) return Array.from({ length: count }, (_, i) => i)
    const result: number[] = []
    for (const part of value.split(",")) {
        const match = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part)
        if (!match) throw new Error("Use page numbers or ranges, for example 1,3-5,2")
        const start = Number(match[1]), end = Number(match[2] ?? match[1]), step = start <= end ? 1 : -1
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < 1 || start > count || end > count) throw new Error(`Pages must be between 1 and ${count}`)
        if (result.length + Math.abs(end - start) + 1 > 10000) throw new Error("Output exceeds 10000 pages")
        for (let n = start; ; n += step) { result.push(n - 1); if (n === end) break }
    }
    return result
}
export async function transform_pdf(file: Blob, options: Options, signal: AbortSignal, tools?: Library): Promise<Blob> {
    signal.throwIfAborted()
    const { PDFDocument } = tools ?? await load_pdf_tools()
    const source = await PDFDocument.load(await file.arrayBuffer())
    signal.throwIfAborted()
    const indices = page_indices(options.pdf_pages ?? "", source.getPageCount()), output = await PDFDocument.create()
    if (!indices.length) throw new Error("PDF has no pages")
    for (const page of await output.copyPages(source, indices)) output.addPage(page)
    signal.throwIfAborted()
    const bytes = await output.save()
    signal.throwIfAborted()
    return new Blob([new Uint8Array(bytes)], { type: "application/pdf" })
}
export const pdf_converter: Converter = {
    id: "pdf-pages", from: "application/pdf", to: "application/pdf", extension: "pdf",
    fields: [{ key: "pdf_pages", label: "Pages in output order (blank = all; e.g. 3,1-2)", value: "" }],
    run: transform_pdf,
}
