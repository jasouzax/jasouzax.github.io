/*
 * Local resource previews; no input is uploaded.
 * html_body shows shared bytes in a sandbox without script or origin privileges.
 * pdf_body delegates local bytes to the lazy PDF viewer.
 * image_pdf_body owns derived output and a cancellable img2pdf process in a private VFS directory.
 * Browser-supported images are rasterized to JPEG on white; conversion is limited to 40 megapixels.
 */
import { text, type desk_window } from "../index.ts"
import { render_window } from "./index.ts"
import { latest_bytes, subscribe_edits } from "../plugin/flow.ts"
import { pdf_viewer } from "./media/pdf.ts"
import { convert_image } from "../conversion/image_pdf.ts"

function preview(): HTMLDivElement {
    const box = document.createElement("div")
    box.className = "desk_preview"
    return box
}

export function html_body(item: desk_window, signal: AbortSignal): HTMLElement {
    const box = preview(), frame = document.createElement("iframe")
    frame.title = `HTML: ${item.name}`
    // No scripts, same-origin access, forms, popups or top navigation in uploaded HTML.
    frame.setAttribute("sandbox", "")
    box.append(frame)
    const update = (bytes: Uint8Array) => { if (!signal.aborted) frame.srcdoc = new TextDecoder().decode(bytes) }
    signal.addEventListener("abort", subscribe_edits(item, update), { once: true })
    void item.file!.arrayBuffer().then(buffer => update(latest_bytes(item) ?? new Uint8Array(buffer)))
    return box
}

export function pdf_body(item: desk_window, signal: AbortSignal): HTMLElement {
    return pdf_viewer(item.file!, item.name, signal)
}

type Conversion = { file: Blob, bytes: Uint8Array | null, result: Promise<Blob> }
const outputs = new WeakMap<desk_window, { file: Blob, bytes: Uint8Array | null, output: Blob }>()
const conversions = new WeakMap<desk_window, Conversion>()

export function image_pdf_body(item: desk_window, signal: AbortSignal): HTMLElement {
    const box = preview(), status = document.createElement("p")
    status.className = "desk_preview_status"; status.setAttribute("role", "status")
    status.textContent = text("convert_pdf_loading")
    box.append(status)
    const parent = item.parent!, file = parent.file!, bytes = latest_bytes(parent)
    signal.addEventListener("abort", subscribe_edits(parent, () => render_window(item)), { once: true })
    const cached = outputs.get(item)
    if (cached && cached.file === file && cached.bytes === bytes) {
        item.file = cached.output
        if (item.mode !== "edit") return pdf_body(item, signal)
        status.textContent = text("convert_pdf_noedit")
        return box
    }
    // An aborted render never reuses an aborted worker, even for the same source.
    const existing = conversions.get(item)
    const result = existing && existing.file === file && existing.bytes === bytes ? existing.result
        : convert_image(bytes ? new Blob([new Uint8Array(bytes)], { type: parent.mime }) : file, signal)
    const entry = { file, bytes, result }
    conversions.set(item, entry)
    signal.addEventListener("abort", () => { if (conversions.get(item) === entry) conversions.delete(item) }, { once: true })
    void result.then(output => {
        if (signal.aborted) return
        item.file = output; item.name = parent.name.replace(/\.[^.]+$/, "") + ".pdf"
        item.path = ""; item.save = null
        if (!item.mode) item.mode = "view"
        outputs.set(item, { file, bytes, output })
        item.el.dataset.converted = "img2pdf"
        render_window(item)
    }).catch(error => { if (!signal.aborted) status.textContent = `${text("conversion_failed")} ${String(error)}` })
    return box
}

