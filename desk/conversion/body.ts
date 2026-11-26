/** Owns a child's derived resource; aborted/failed runs cannot publish stale bytes. */
import { text, type desk_window } from "../index.ts"
import { latest_bytes, subscribe_edits, forget_edits } from "../plugin/flow.ts"
import { render_window } from "../window/index.ts"
import { converters } from "./index.ts"
import { route, execute } from "./graph.ts"
const outputs = new WeakMap<desk_window, { source: Blob, bytes: Uint8Array | null, key: string, output: Blob }>()
export function conversion_body(item: desk_window, signal: AbortSignal): HTMLElement | null {
    const parent = item.parent!, source = parent.file, bytes = latest_bytes(parent)
    signal.addEventListener("abort", subscribe_edits(parent, () => render_window(item)), { once: true })
    const key = JSON.stringify([parent.mime, item.mime, item.conversion ?? {}]), cached = outputs.get(item)
    if (source && cached?.source === source && cached.bytes === bytes && cached.key === key) { item.file ??= cached.output; return null }
    item.file = null; item.commit = null; item.save = null; item.path = ""
    forget_edits(item)
    const box = document.createElement("div")
    box.className = "desk_preview desk_wbox_body_none"; box.setAttribute("role", "status")
    const path = route(converters, parent.mime, item.mime)
    box.textContent = !source ? "Waiting for parent data…" : !path ? text("conversion_unavailable").replace("{from}", parent.mime).replace("{to}", item.mime) : "Converting…"
    delete item.el.dataset.converted
    if (!source || !path) return box
    void execute(path, bytes ? new Blob([new Uint8Array(bytes)], { type: parent.mime }) : source, item.conversion ?? {}, signal).then(output => {
        if (signal.aborted) return
        outputs.set(item, { source, bytes, key, output })
        item.file = output
        const suffix = item.mime === "application/pdf" && item.conversion?.pdf_pages ? "-pages-" + item.conversion.pdf_pages.replace(/[^0-9,-]/g, "") : ""
        item.name = path.length ? parent.name.replace(/\.[^.]+$/, "") + suffix + "." + path.at(-1)!.extension : parent.name
        item.mode ||= /^(text\/|application\/(?:.*json|.*xml|javascript|typescript|x-sh|x-yaml|sql)$)/.test(item.mime) ? "edit" : "view"
        item.el.dataset.converted = path.map(edge => edge.id).join(",")
        render_window(item)
    }).catch(error => { if (!signal.aborted) box.textContent = `Conversion failed: ${String(error)}` })
    return box
}
