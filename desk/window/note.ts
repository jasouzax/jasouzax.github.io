import { markdown_nodes } from "../../shared/markdown.ts"
import { to_dom } from "../../shared/vnode/vnode.tsx"
import type { desk_window } from "../index.ts"
import { text } from "../index.ts"
import { latest_bytes, subscribe_edits } from "../plugin/flow.ts"
import { text_layout_body } from "./text.ts"
import { ipynb_body } from "./note/notebook.ts"
import { notebook_mime } from "../../shared/notebook.ts"


export function markdown_body(item: desk_window, signal: AbortSignal): HTMLElement {
    const body = document.createElement("div")
    body.className = "desk_wbox_body_doc"
    const draw = (bytes: Uint8Array) => { if (!signal.aborted) body.replaceChildren(to_dom(markdown_nodes(new TextDecoder().decode(bytes)))) }
    signal.addEventListener("abort", subscribe_edits(item, draw), { once: true })
    void item.file!.arrayBuffer().then(buffer => {
        draw(latest_bytes(item) ?? new Uint8Array(buffer))
    }).catch(() => {
        if (!signal.aborted) body.textContent = text("files_failed")
    })
    return body
}

export function notebook_body(item: desk_window, signal: AbortSignal): HTMLElement {
    if (item.mime === notebook_mime) return ipynb_body(item, signal)
    return item.mode === "edit" ? text_layout_body(item) : markdown_body(item, signal)
}
