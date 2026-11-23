/* Local notebook editing participates in the same shared-document/save flow as text windows. */
import { text, type desk_window } from "../../index.ts"
import { announce_edit, latest_bytes, subscribe_edits, is_dirty } from "../../plugin/flow.ts"
import { sync_save } from "../../action/save.ts"
import { to_dom } from "../../../shared/vnode/vnode.tsx"
import { parse_notebook, notebook_text, encode_notebook, edit_cell, insert_cell, delete_cell, move_cell, clear_outputs, notebook_limit, type notebook, type notebook_cell } from "../../../shared/notebook.ts"
import { notebook_cell_content, notebook_markdown, notebook_outputs } from "../../../shared/notebook/render.tsx"

function element<K extends keyof HTMLElementTagNameMap>(tag: K, class_name = "", value = ""): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag); node.className = class_name; node.textContent = value
    return node
}

export function ipynb_body(item: desk_window, signal: AbortSignal): HTMLElement {
    const body = element("div", "desk_notebook"), editable = item.mode === "edit", file = item.file!
    item.problem = text("note_loading")
    const toolbar = element("div", "notebook_toolbar"), status = element("p", "notebook_status", text("note_loading")), cells = element("div", "notebook_cells")
    status.setAttribute("role", "status")
    const history: notebook[] = [], future: notebook[] = []
    let document: notebook | null = null, bytes = new Uint8Array(), own: Uint8Array | null = null
    let drawing = new AbortController(), last_edit = "", last_time = 0
    const controls: HTMLButtonElement[] = []
    const button = (parent: HTMLElement, label: string, action: string, run: () => void, active_signal = signal): HTMLButtonElement => {
        const node = element("button", "", label)
        node.type = "button"; node.dataset.noteAction = action
        node.addEventListener("click", run, { signal: active_signal }); parent.append(node)
        return node
    }
    const update_status = () => {
        item.dirty = is_dirty(item)
        sync_save(item)
        controls.forEach(control => control.disabled = !document)
        undo.disabled = !document || history.length === 0; redo.disabled = !document || future.length === 0
        for (const control of controls.filter(node => node.dataset.noteAction?.startsWith("add-"))) control.disabled ||= (document?.cells.length ?? 0) >= 1000
    }
    const publish = () => {
        if (!document) return
        bytes = new TextEncoder().encode(encode_notebook(document)); own = bytes
        item.problem = bytes.length > notebook_limit ? text("edit_too_large") : ""
        status.textContent = item.problem || text("note_stored_outputs")
        announce_edit(item, bytes)
        update_status()
    }
    const change = (next: notebook, key = "") => {
        if (!document || next === document) return
        const now = Date.now()
        if (!key || key !== last_edit || now - last_time > 750) { history.push(document); if (history.length > 20) history.shift() }
        last_edit = key; last_time = now
        document = next; future.length = 0; publish()
    }
    const undo = button(toolbar, text("note_undo"), "undo", () => {
        if (!document || !history.length) return
        future.push(document); document = history.pop()!; last_edit = ""; publish(); draw()
    })
    const redo = button(toolbar, text("note_redo"), "redo", () => {
        if (!document || !future.length) return
        history.push(document); document = future.pop()!; last_edit = ""; publish(); draw()
    })
    if (editable) {
        for (const kind of ["code", "markdown", "raw"] as const) controls.push(button(toolbar, text(`note_add_${kind}`), `add-${kind}`, () => {
            if (!document || document.cells.length >= 1000) return
            change(insert_cell(document, document.cells.length, kind)); draw()
            cells.lastElementChild?.querySelector("textarea")?.focus()
        }))
        controls.push(undo, redo); body.append(toolbar)
        item.commit = async () => document && !item.problem ? new Blob([new Uint8Array(bytes)], { type: item.mime }) : null
    }
    body.append(status, cells)
    const content = (cell: notebook_cell): Node => to_dom(editable
        ? cell.cell_type === "markdown" ? notebook_markdown(notebook_text(cell.source), cell.attachments) : notebook_outputs(cell)
        : notebook_cell_content(cell))
    const focus_cell = (index: number) => cells.children[Math.max(0, Math.min(index, cells.children.length - 1))]?.querySelector("textarea")?.focus()
    const draw = () => {
        drawing.abort(); drawing = new AbortController()
        const nodes = (document?.cells ?? []).map((cell, index) => {
            const section = element("section", "notebook_cell"), head = element("header", "notebook_cell_head")
            section.dataset.cellIndex = String(index); section.dataset.cellType = cell.cell_type
            const label = text(`note_kind_${cell.cell_type}`)
            const title = element("h3", "", `${index + 1}. ${label === `note_kind_${cell.cell_type}` ? cell.cell_type : label}`)
            title.id = `notebook_cell_${item.id}_${index}`; section.setAttribute("aria-labelledby", title.id)
            head.append(title)
            if (cell.cell_type === "code" && cell.execution_count !== null) head.append(element("span", "", `[${String(cell.execution_count)}]`))
            section.append(head)
            if (editable) {
                const up = button(head, text("note_move_up"), "up", () => { if (document && index > 0) { change(move_cell(document, index, -1)); draw(); focus_cell(index - 1) } }, drawing.signal)
                up.disabled = index === 0
                const down = button(head, text("note_move_down"), "down", () => { if (document && index + 1 < document.cells.length) { change(move_cell(document, index, 1)); draw(); focus_cell(index + 1) } }, drawing.signal)
                down.disabled = index + 1 === document!.cells.length
                button(head, text("note_delete"), "delete", () => { if (document) { change(delete_cell(document, index)); draw(); focus_cell(index) } }, drawing.signal)
                if (cell.cell_type === "code") {
                    const clear = button(head, text("note_clear_outputs"), "clear-outputs", () => { if (document) { change(clear_outputs(document, index)); draw() } }, drawing.signal)
                    clear.disabled = !(Array.isArray(cell.outputs) && cell.outputs.length || cell.execution_count !== null)
                }
                const area = element("textarea", "notebook_input")
                area.spellcheck = false; area.value = notebook_text(cell.source); area.rows = Math.min(16, Math.max(3, area.value.split("\n").length))
                area.setAttribute("aria-label", text("note_cell_source").replace("{n}", String(index + 1)))
                const preview = element("div", "notebook_preview"); preview.append(content(cell))
                area.addEventListener("input", () => {
                    if (!document) return
                    change(edit_cell(document, index, area.value), `cell:${index}`)
                    preview.replaceChildren(content(document.cells[index]))
                }, { signal: drawing.signal })
                area.addEventListener("keydown", event => {
                    if (event.key !== "Tab" || event.shiftKey) return
                    event.preventDefault(); area.setRangeText("\t", area.selectionStart, area.selectionEnd, "end"); area.dispatchEvent(new Event("input", { bubbles: true }))
                }, { signal: drawing.signal })
                section.append(area, preview)
            } else section.append(content(cell))
            return section
        })
        cells.replaceChildren(...nodes)
        update_status()
    }
    const receive = (next: Uint8Array) => {
        if (signal.aborted) return
        if (next === own) { update_status(); return }
        bytes = new Uint8Array(next)
        try {
            document = parse_notebook(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
            item.problem = ""; status.textContent = text("note_stored_outputs")
        } catch {
            document = null; item.problem = text("note_invalid"); status.textContent = item.problem
        }
        history.length = future.length = 0; last_edit = ""; draw()
    }
    signal.addEventListener("abort", subscribe_edits(item, receive), { once: true })
    signal.addEventListener("abort", () => drawing.abort(), { once: true })
    if (file.size > notebook_limit) {
        item.problem = text("edit_too_large"); status.textContent = item.problem; update_status()
    } else void file.arrayBuffer().then(buffer => {
        if (!signal.aborted) receive(latest_bytes(item) ?? new Uint8Array(buffer))
    }).catch(() => { if (!signal.aborted) { item.problem = text("files_failed"); status.textContent = item.problem; update_status() } })
    update_status()
    return body
}
