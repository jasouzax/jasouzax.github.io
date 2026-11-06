import MarkdownIt from "markdown-it"
import type { desk_window } from "./desk.ts"
import { text } from "./desk.ts"

const markdown = new MarkdownIt({ html: false, linkify: true })

export function markdown_body(item: desk_window, signal: AbortSignal): HTMLElement {
    const body = document.createElement("div")
    body.className = "desk_wbox_body_doc"
    void item.file!.text().then(value => {
        if (!signal.aborted) body.innerHTML = markdown.render(value)
    }).catch(() => {
        if (!signal.aborted) body.textContent = text("files_failed")
    })
    return body
}
