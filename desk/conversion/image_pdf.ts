import { kernel, start_process, make_sink, kill } from "../kernel/process.ts"
export async function convert_image(file: Blob, signal: AbortSignal, prepared_jpeg = false): Promise<Blob> {
    if (!kernel.hooks) throw new Error("Desk runtime is not ready")
    let jpeg: Blob
    if (prepared_jpeg && file.type === "image/jpeg") jpeg = file
    else {
        const image = await createImageBitmap(file)
        try {
            if (image.width * image.height > 40_000_000) throw new Error("Image exceeds 40 megapixels")
            const canvas = document.createElement("canvas")
            canvas.width = image.width; canvas.height = image.height
            const context = canvas.getContext("2d")!
            context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height)
            context.drawImage(image, 0, 0)
            jpeg = await new Promise<Blob>((done, fail) => canvas.toBlob(blob => blob ? done(blob) : fail(new Error("Image encoding failed")), "image/jpeg", .95))
        } finally { image.close() }
    }
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
