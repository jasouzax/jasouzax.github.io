import { markdown_nodes } from "../../shared/markdown.ts"
import { to_dom } from "../../shared/vnode/vnode.tsx"
import type { desk_window } from "../index.ts"
import { text } from "../index.ts"


export function markdown_body(item: desk_window, signal: AbortSignal): HTMLElement {
    const body = document.createElement("div")
    body.className = "desk_wbox_body_doc"
    void item.file!.text().then(value => {
        if (!signal.aborted) body.replaceChildren(to_dom(markdown_nodes(value)))
    }).catch(() => {
        if (!signal.aborted) body.textContent = text("files_failed")
    })
    return body
}
