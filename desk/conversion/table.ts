/** RFC-style delimited tables use JSON records as their shared intermediate format. */
import type { Converter } from "./graph.ts"
export function parse_table(text: string, delimiter: string): Record<string, string>[] {
    const rows: string[][] = [], row: string[] = []
    let cell = "", quoted = false, closed = false
    text = text.replace(/^\uFEFF/, "")
    for (let i = 0; i < text.length; i++) {
        const ch = text[i]
        if (quoted) {
            if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++ } else { quoted = false; closed = true } }
            else cell += ch
        } else if (ch === delimiter) { row.push(cell); cell = ""; closed = false }
        else if (ch === "\r" || ch === "\n") {
            if (ch === "\r" && text[i + 1] === "\n") i++
            row.push(cell); rows.push(row.splice(0)); cell = ""; closed = false
        } else if (ch === '"' && !cell && !closed) quoted = true
        else { if (closed || ch === '"') throw new Error("Invalid quoted table field"); cell += ch }
    }
    if (quoted) throw new Error("Unterminated quoted table field")
    if (cell || row.length || closed) { row.push(cell); rows.push(row) }
    const headers = rows.shift()
    if (!headers) return []
    if (headers.some(header => !header) || new Set(headers).size !== headers.length) throw new Error("Table headers must be nonempty and unique")
    return rows.map(row => {
        if (row.length !== headers.length) throw new Error("Table rows must match the header column count")
        return Object.fromEntries(headers.map((header, i) => [header, row[i]]))
    })
}
export function write_table(value: unknown, delimiter: string): string {
    if (!Array.isArray(value) || value.some(row => !row || typeof row !== "object" || Array.isArray(row))) throw new Error("Expected a JSON array of records")
    const headers = [...new Set(value.flatMap(row => Object.keys(row)))]
    if (!headers.length) return ""
    if (headers.some(header => !header)) throw new Error("Table headers must be nonempty")
    const quote = (value: unknown) => {
        const cell = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value)
        return cell.includes(delimiter) || /["\r\n]/.test(cell) ? '"' + cell.replace(/"/g, '""') + '"' : cell
    }
    return [headers, ...value.map(row => headers.map(header => Object.hasOwn(row, header) ? row[header] : ""))].map(row => row.map(quote).join(delimiter)).join("\r\n") + "\r\n"
}
export const table_converters: Converter[] = [["text/csv", ",", "csv"], ["text/tab-separated-values", "\t", "tsv"]].flatMap(([mime, delimiter, extension]) => [
    { id: `${extension}-json`, from: mime, to: "application/json", extension: "json", run: async file => new Blob([JSON.stringify(parse_table(await file.text(), delimiter), null, 2)], { type: "application/json" }) },
    { id: `json-${extension}`, from: "application/json", to: mime, extension, run: async file => new Blob([write_table(JSON.parse(await file.text()), delimiter)], { type: mime }) },
])
