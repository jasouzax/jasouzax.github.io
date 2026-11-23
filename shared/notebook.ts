/* nbformat 4 documents. Edits preserve unknown metadata, outputs, attachments and future fields. */
export const notebook_mime = "application/x-ipynb+json"
export const notebook_limit = 2_000_000
export type notebook_cell = Record<string, unknown> & { cell_type: string, source: string | string[], metadata: Record<string, unknown>, id?: string }
export type notebook = Record<string, unknown> & { nbformat: 4, nbformat_minor: number, metadata: Record<string, unknown>, cells: notebook_cell[] }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value)
export function notebook_text(value: unknown): string {
    if (typeof value === "string") return value
    return Array.isArray(value) && value.every(part => typeof part === "string") ? value.join("") : ""
}

export function parse_notebook(source: string): notebook {
    if (new TextEncoder().encode(source).length > notebook_limit) throw new Error("Notebook exceeds the editing limit")
    const value: unknown = JSON.parse(source)
    if (!object(value) || value.nbformat !== 4 || !Number.isInteger(value.nbformat_minor) || Number(value.nbformat_minor) < 0 || !object(value.metadata) || !Array.isArray(value.cells) || value.cells.length > 1000) throw new Error("Expected an nbformat 4 notebook with at most 1000 cells")
    const ids = new Set<string>()
    let output_count = 0
    for (const cell of value.cells) {
        if (!object(cell) || typeof cell.cell_type !== "string" || !object(cell.metadata) || !(typeof cell.source === "string" || Array.isArray(cell.source) && cell.source.every(part => typeof part === "string"))) throw new Error("Invalid notebook cell")
        if (cell.id !== undefined || Number(value.nbformat_minor) >= 5) {
            if (typeof cell.id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(cell.id) || ids.has(cell.id)) throw new Error("Notebook cell IDs must be valid and unique")
            ids.add(cell.id)
        }
        if (cell.cell_type === "code" && (!Array.isArray(cell.outputs) || cell.outputs.some(output => !object(output)) || !(cell.execution_count === null || Number.isInteger(cell.execution_count) && Number(cell.execution_count) >= 0))) throw new Error("Invalid code cell outputs or execution count")
        if (Array.isArray(cell.outputs)) output_count += cell.outputs.length
        if (output_count > 2000) throw new Error("Notebook exceeds the stored-output rendering limit")
        if (cell.attachments !== undefined && !object(cell.attachments)) throw new Error("Invalid cell attachments")
    }
    return value as notebook
}

function cell_at(document: notebook, index: number): notebook_cell {
    if (!Number.isInteger(index) || index < 0 || index >= document.cells.length) throw new Error("Invalid cell index")
    return document.cells[index]
}
function replace_cell(document: notebook, index: number, cell: notebook_cell): notebook {
    const cells = document.cells.slice(); cells[index] = cell
    return { ...document, cells }
}
export function edit_cell(document: notebook, index: number, source: string): notebook {
    const cell = cell_at(document, index)
    if (notebook_text(cell.source) === source) return document
    return replace_cell(document, index, { ...cell, source: Array.isArray(cell.source) ? source.match(/[^\n]*\n|[^\n]+$/g) ?? [] : source })
}
export function insert_cell(document: notebook, index: number, kind: "code" | "markdown" | "raw", id: string = crypto.randomUUID()): notebook {
    if (!Number.isInteger(index) || index < 0 || index > document.cells.length || document.cells.length >= 1000 || !["code", "markdown", "raw"].includes(kind) || !/^[a-zA-Z0-9_-]{1,64}$/.test(id) || document.cells.some(cell => cell.id === id)) throw new Error("Invalid new cell")
    const cell: notebook_cell = { cell_type: kind, id, metadata: {}, source: "", ...(kind === "code" ? { outputs: [], execution_count: null } : {}) }
    const cells = document.cells.slice(); cells.splice(index, 0, cell)
    return { ...document, cells }
}
export function delete_cell(document: notebook, index: number): notebook {
    cell_at(document, index)
    return { ...document, cells: document.cells.filter((_, at) => at !== index) }
}
export function move_cell(document: notebook, index: number, offset: -1 | 1): notebook {
    cell_at(document, index); cell_at(document, index + offset)
    const cells = document.cells.slice(); [cells[index], cells[index + offset]] = [cells[index + offset], cells[index]]
    return { ...document, cells }
}
export function clear_outputs(document: notebook, index: number): notebook {
    const cell = cell_at(document, index)
    return cell.cell_type === "code" ? replace_cell(document, index, { ...cell, outputs: [], execution_count: null }) : document
}
export function encode_notebook(document: notebook): string { return JSON.stringify(document, null, 2) + "\n" }
