/* Sandboxed HTML, lazy PDF viewing and image-to-PDF conversion. Conversion runs the existing img2pdf WASM process against owned temporary files. */
import type { desk_window } from "./desk.ts"
import { render_window } from "./desk_view.ts"
import { latest_bytes, subscribe_edits } from "./desk_flow.ts"
import { pdf_viewer } from "./desk_pdf.ts"
import { kernel, start_process, make_sink, kill } from "./kernel.ts"

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
    status.textContent = "Converting image to PDFÃ¢â‚¬Â¦"
    box.append(status)
    const parent = item.parent!, file = parent.file!, bytes = latest_bytes(parent)
    const cached = outputs.get(item)
    if (cached && cached.file === file && cached.bytes === bytes) {
        item.file = cached.output
        if (item.mode !== "edit") return pdf_body(item, signal)
        status.textContent = "PDF editing is unsupported. Choose View to read the PDF."
        return box
    }
    signal.addEventListener("abort", subscribe_edits(parent, () => render_window(item)), { once: true })
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
    }).catch(error => { if (!signal.aborted) status.textContent = `Conversion failed: ${String(error)}` })
    return box
}

async function convert_image(file: Blob, signal: AbortSignal): Promise<Blob> {
    if (!kernel.hooks) throw new Error("Desk runtime is not ready")
    const image = await createImageBitmap(file)
    let jpeg: Blob
    try {
        if (image.width * image.height > 40_000_000) throw new Error("Image exceeds 40 megapixels")
        const canvas = document.createElement("canvas")
        canvas.width = image.width; canvas.height = image.height
        const context = canvas.getContext("2d")!
        context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height)
        context.drawImage(image, 0, 0)
        jpeg = await new Promise<Blob>((done, fail) => canvas.toBlob(blob => blob ? done(blob) : fail(new Error("Image encoding failed")), "image/jpeg", .95))
    } finally { image.close() }
    await kernel.hooks.programs()
    signal.throwIfAborted()
    const fs = kernel.hooks.fs(1000, 1000), dir = `/tmp/image-pdf-${crypto.randomUUID()}`
    if (!fs.write_bytes || !fs.read_bytes) throw new Error("Binary file system is unavailable")
    await fs.mkdir(dir)
    try {
        await fs.write_bytes(`${dir}/input.jpg`, new Uint8Array(await jpeg.arrayBuffer()))
        signal.throwIfAborted()
        let errors = ""
        const process = start_process(["img2pdf", "-o", `${dir}/output.pdf`, `${dir}/input.jpg`], {
            cwd: dir, env: { PATH: "/bin", HOME: "/home/user" }, background: true,
            stderr: make_sink(value => { errors = (errors + value).slice(-2000) }),
        })
        const cancel = () => { kill(process.pid) }
        signal.addEventListener("abort", cancel, { once: true })
        try {
            if (signal.aborted) cancel()
            const code = await process.done
            signal.throwIfAborted()
            if (code !== 0) throw new Error(errors || `img2pdf exited ${code}`)
            const output = await fs.read_bytes(`${dir}/output.pdf`)
            if (new TextDecoder().decode(output.slice(0, 5)) !== "%PDF-") throw new Error("img2pdf returned invalid PDF data")
            return new Blob([new Uint8Array(output)], { type: "application/pdf" })
        } finally { signal.removeEventListener("abort", cancel) }
    } finally { await fs.remove(dir, true) }
}
