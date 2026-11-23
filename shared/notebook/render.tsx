/* Stored notebook output is data: no HTML, scripts, widgets or remote image requests execute. */
import { jsx, fragment, type child } from "../vnode/vnode.tsx"
import { markdown_nodes } from "../markdown.ts"
import { notebook_text, type notebook_cell } from "../notebook.ts"

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
const raster_types = ["image/png", "image/jpeg", "image/gif", "image/webp"]
function image(bundle: Record<string, unknown>): string | null {
    for (const mime of raster_types) {
        const data = notebook_text(bundle[mime]).replace(/\s/g, "")
        if (data && data.length <= 2_000_000 && data.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(data)) return `data:${mime};base64,${data}`
    }
    return null
}
export function notebook_markdown(source: string, attachments: unknown = {}, heading_offset = 0): child {
    const nodes = markdown_nodes(source), files = record(attachments)
    const visit = (node: child): void => {
        if (Array.isArray(node)) node.forEach(visit)
        else if (node && typeof node === "object" && "tag" in node) {
            if (heading_offset && /^h[1-6]$/.test(node.tag ?? "")) node.tag = `h${Math.min(6, Number(node.tag![1]) + heading_offset)}`
            if (node.tag === "img") {
                const reference = String(node.attrs.src ?? "")
                const src = reference.startsWith("attachment:") ? image(record(files[reference.slice(11)])) : null
                if (src) node.attrs.src = src
                else { node.tag = null; node.children = [String(node.attrs.alt ?? "")]; node.attrs = {} }
            }
            node.children.forEach(visit)
        }
    }
    nodes.forEach(visit)
    return nodes
}

export function notebook_outputs(cell: notebook_cell, heading_offset = 0): child {
    const outputs = Array.isArray(cell.outputs) ? cell.outputs : []
    return outputs.map(value => {
        const output = record(value)
        if (output.output_type === "stream") return <pre class="notebook_output" data-output={typeof output.name === "string" ? output.name : "stdout"}>{notebook_text(output.text)}</pre>
        if (output.output_type === "error") return <pre class="notebook_output notebook_error">{(Array.isArray(output.traceback) ? notebook_text(output.traceback.map(line => typeof line === "string" ? line + "\n" : "")) : `${typeof output.ename === "string" ? output.ename : "Error"}: ${notebook_text(output.evalue)}`).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")}</pre>
        const data = record(output.data), src = image(data)
        if (src) return <img class="notebook_image" src={src} alt=""/>
        if (data["text/plain"] !== undefined) return <pre class="notebook_output">{notebook_text(data["text/plain"])}</pre>
        if (data["text/markdown"] !== undefined) return <div class="notebook_output">{notebook_markdown(notebook_text(data["text/markdown"]), {}, heading_offset)}</div>
        if (data["text/html"] !== undefined) return <pre class="notebook_output">{notebook_text(data["text/html"])}</pre>
        return <pre class="notebook_output">{JSON.stringify(output, null, 2)}</pre>
    })
}
export function notebook_cell_content(cell: notebook_cell, heading_offset = 0): child {
    return <>
        {cell.cell_type === "markdown" ? <div class="notebook_prose">{notebook_markdown(notebook_text(cell.source), cell.attachments, heading_offset)}</div> : <pre class="notebook_source"><code>{notebook_text(cell.source)}</code></pre>}
        {notebook_outputs(cell, heading_offset)}
    </>
}
