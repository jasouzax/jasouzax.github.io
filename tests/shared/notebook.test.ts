/* Notebook edits round-trip unknown fields; stored rich output never becomes executable markup. */
import { test } from "node:test"
import assert from "node:assert/strict"
import { parseHTML } from "linkedom"
import { parse_notebook, notebook_text, encode_notebook, edit_cell, insert_cell, delete_cell, move_cell, clear_outputs, notebook_limit } from "../../shared/notebook.ts"
import { notebook_cell_content, notebook_markdown } from "../../shared/notebook/render.tsx"
import { to_html, serialize, deserialize } from "../../shared/vnode/vnode.tsx"

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jQ2kAAAAASUVORK5CYII="
function fixture() {
    return parse_notebook(JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: { kernelspec: { name: "python3" }, custom: { private_value: "keep" } }, future_root: ["preserved"], cells: [
        { id: "intro", cell_type: "markdown", metadata: { custom: "cell" }, source: ["# Title\n", "Text"], attachments: { "pixel.png": { "image/png": png } }, future_cell: "unchanged" },
        { id: "code", cell_type: "code", metadata: {}, source: "print(1)", execution_count: 7, outputs: [{ output_type: "stream", name: "stdout", text: ["1", "\n"], future_output: true }] },
    ] }))
}

test("source editing preserves unknown root/cell/output fields, attachments and line-array representation", () => {
    const document = fixture(), before = JSON.stringify(document)
    const edited = edit_cell(document, 0, "# Revised\n\nText\n")
    assert.equal(JSON.stringify(document), before)
    assert.deepEqual(edited.cells[0].source, ["# Revised\n", "\n", "Text\n"])
    assert.deepEqual(edited.metadata, document.metadata)
    assert.deepEqual(edited.future_root, document.future_root)
    assert.deepEqual(edited.cells[0].attachments, document.cells[0].attachments)
    assert.equal(edited.cells[0].future_cell, "unchanged")
    assert.deepEqual(edited.cells[1], document.cells[1])
    assert.deepEqual(parse_notebook(encode_notebook(edited)), edited)
    assert.equal(edit_cell(document, 0, notebook_text(document.cells[0].source)), document)
    const code = edit_cell(document, 1, "print(2)")
    assert.equal(code.cells[1].execution_count, 7)
    assert.deepEqual(code.cells[1].outputs, document.cells[1].outputs)
})

test("insert, move, delete and explicit output clearing retain cell identities and valid documents", () => {
    const document = fixture(), added = insert_cell(document, 1, "code", "new-code")
    assert.equal(added.cells[1].execution_count, null)
    assert.deepEqual(added.cells[1].outputs, [])
    assert.deepEqual(move_cell(added, 1, 1).cells.map(cell => cell.id), ["intro", "code", "new-code"])
    assert.deepEqual(delete_cell(added, 1), document)
    const cleared = clear_outputs(document, 1)
    assert.deepEqual(cleared.cells[1].outputs, [])
    assert.equal(cleared.cells[1].execution_count, null)
    assert.equal(cleared.cells[1].source, document.cells[1].source)
    assert.equal(clear_outputs(document, 0), document)
    assert.throws(() => insert_cell(document, 0, "raw", "intro"), /Invalid new cell/)
    assert.throws(() => delete_cell(document, -1), /index/)
    assert.throws(() => move_cell(document, 0, -1), /index/)
})

test("legacy nbformat 4 sources need no IDs; invalid, oversized and ambiguous inputs are refused", () => {
    const old = fixture(); old.nbformat_minor = 0; old.cells.forEach(cell => delete cell.id)
    assert.deepEqual(parse_notebook(encode_notebook(old)), old)
    for (const mutate of [
        (value: any) => value.nbformat = 3,
        (value: any) => value.cells[1].id = "intro",
        (value: any) => delete value.cells[0].id,
        (value: any) => value.cells[0].source = ["text", 4],
        (value: any) => value.cells[1].outputs = {},
        (value: any) => value.cells[1].outputs = Array.from({ length: 2001 }, () => ({})),
        (value: any) => value.cells[1].execution_count = -1,
    ]) { const value = fixture(); mutate(value); assert.throws(() => parse_notebook(JSON.stringify(value))) }
    assert.throws(() => parse_notebook(" ".repeat(notebook_limit + 1)), /limit/)
})

test("stored HTML, JavaScript and remote images stay inert while local raster attachments render", () => {
    const document = fixture(), cell = document.cells[1]
    cell.outputs = [
        { output_type: "display_data", data: { "text/html": '<img src="https://private.example/track" onerror="alert(1)"><script>alert(1)</script>' } },
        { output_type: "display_data", data: { "application/javascript": "globalThis.compromised=true" } },
        { output_type: "error", ename: "Error", evalue: "boom", traceback: ["\u001b[31mError: boom\u001b[0m"] },
        { output_type: "error", ename: { toString: "malformed" }, evalue: {} },
        { output_type: "stream", name: { toString: "malformed" }, text: "Untrusted shape" },
    ]
    const tree = notebook_cell_content(cell), html = to_html(tree)
    assert.equal(to_html(deserialize(serialize(tree))), html)
    const parsed = parseHTML(html).document
    assert.equal(parsed.querySelectorAll("script,img,iframe,object").length, 0)
    assert(parsed.querySelector("pre")?.textContent.includes("print(1)"))
    assert(html.includes("&lt;script&gt;"))
    assert(!html.includes("\u001b[31m"))
    const markdown = parseHTML(to_html(notebook_markdown('![Local](attachment:pixel.png) ![Remote](https://private.example/track) ![SVG](data:image/svg+xml;base64,AAAA)', document.cells[0].attachments))).document
    assert.equal(markdown.querySelectorAll("img").length, 1)
    assert.equal(markdown.querySelector("img")?.getAttribute("src"), `data:image/png;base64,${png}`)
    assert(markdown.toString().includes("Remote"))
})
