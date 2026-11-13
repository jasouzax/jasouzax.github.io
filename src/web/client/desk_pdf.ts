/* Lazy, browser-independent PDF viewer. PDF.js renders local bytes; no document is uploaded or allowed to execute actions. */
import { text } from "./desk.ts"
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist"

type Pdf_Assets = { base: string, module: string, worker: string }
let library: Promise<{ pdf: typeof import("pdfjs-dist"), assets: Pdf_Assets }> | null = null
function load_pdf(): NonNullable<typeof library> {
    return library ??= (async () => {
        const response = await fetch("/assets/pdfjs.json", { cache: "no-cache" })
        if (!response.ok) throw new Error(`PDF viewer assets: ${response.status}`)
        const assets: Pdf_Assets = await response.json()
        const pdf = await import(assets.module) as typeof import("pdfjs-dist")
        pdf.GlobalWorkerOptions.workerSrc = assets.worker
        return { pdf, assets }
    })().catch(error => { library = null; throw error })
}

export function pdf_viewer(file: Blob, name: string, signal: AbortSignal): HTMLElement {
    const box = document.createElement("div"), controls = document.createElement("div"), viewport = document.createElement("div")
    box.className = "desk_preview desk_pdf"
    controls.className = "desk_pdf_controls"; viewport.className = "desk_pdf_viewport"
    const status = document.createElement("span"), canvas = document.createElement("canvas"), download = document.createElement("a")
    status.setAttribute("role", "status"); status.textContent = text("pdf_loading")
    canvas.setAttribute("role", "img")
    const button = (label: string, click: () => void) => {
        const node = document.createElement("button"); node.type = "button"; node.textContent = label
        node.addEventListener("click", click); controls.append(node); return node
    }
    let pdf_document: PDFDocumentProxy | null = null, loading: PDFDocumentLoadingTask | null = null, running: RenderTask | null = null
    let page = 1, zoom = 1, revision = 0, chain = Promise.resolve()
    const previous = button(text("pdf_previous"), () => { if (page > 1) { page--; draw() } })
    const next = button(text("pdf_next"), () => { if (pdf_document && page < pdf_document.numPages) { page++; draw() } })
    button(text("pdf_zoom_out"), () => { zoom = Math.max(.25, zoom / 1.25); draw() })
    button(text("pdf_zoom_in"), () => { zoom = Math.min(4, zoom * 1.25); draw() })
    const url = URL.createObjectURL(new Blob([file], { type: "application/pdf" }))
    download.href = url; download.download = name; download.textContent = text("pdf_download")
    controls.append(status); viewport.append(canvas); box.append(controls, viewport, download)
    previous.disabled = next.disabled = true
    function draw(): void {
        const current = ++revision
        running?.cancel()
        chain = chain.catch(() => {}).then(async () => {
            if (signal.aborted || current !== revision || !pdf_document) return
            const pdf_page = await pdf_document.getPage(page)
            if (signal.aborted || current !== revision) return
            const original = pdf_page.getViewport({ scale: 1 })
            const scale = Math.min(2, Math.max(.1, (viewport.clientWidth - 32) / original.width)) * zoom
            const ratio = Math.min(2, window.devicePixelRatio || 1)
            const view = pdf_page.getViewport({ scale: scale * ratio })
            if (view.width * view.height > 32_000_000) throw new Error("PDF page exceeds the rendering limit; reduce zoom")
            canvas.width = Math.ceil(view.width); canvas.height = Math.ceil(view.height)
            canvas.style.width = `${view.width / ratio}px`; canvas.style.height = `${view.height / ratio}px`
            canvas.setAttribute("aria-label", `${name}, page ${page} of ${pdf_document.numPages}`)
            running = pdf_page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport: view })
            await running.promise
            if (signal.aborted || current !== revision) return
            box.dataset.pdfReady = "true"
            status.textContent = `${page} / ${pdf_document.numPages}`
            previous.disabled = page === 1; next.disabled = page === pdf_document.numPages
        }).catch(error => {
            if (!signal.aborted && current === revision) status.textContent = `${text("pdf_failed")} ${String(error)}`
        })
    }
    const observer = new ResizeObserver(() => draw())
    observer.observe(viewport)
    signal.addEventListener("abort", () => {
        observer.disconnect(); running?.cancel(); void loading?.destroy().catch(() => {}); URL.revokeObjectURL(url)
    }, { once: true })
    void load_pdf().then(async ({ pdf, assets }) => {
        if (signal.aborted) return
        loading = pdf.getDocument({ data: new Uint8Array(await file.arrayBuffer()), enableXfa: false,
            cMapUrl: assets.base + "cmaps/", cMapPacked: true, standardFontDataUrl: assets.base + "standard_fonts/", wasmUrl: assets.base + "wasm/" })
        if (signal.aborted) { await loading.destroy(); return }
        pdf_document = await loading.promise
        if (!signal.aborted) draw()
    }).catch(error => { if (!signal.aborted) status.textContent = `${text("pdf_failed")} ${String(error)}` })
    return box
}
