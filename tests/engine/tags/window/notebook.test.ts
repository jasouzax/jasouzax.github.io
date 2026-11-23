/* Published notebook snapshots are readable without JS and print semantically instead of dumping JSON metadata. */
import { test } from "node:test"
import assert from "node:assert/strict"
import { parseHTML } from "linkedom"
import { parse_xml } from "../../../../shared/content/xml.ts"
import { load_config } from "../../../../shared/config.ts"
import { notebook_mime } from "../../../../shared/notebook.ts"
import { render_window_body } from "../../../../engine/tags/window.tsx"
import { render_book } from "../../../../engine/tags/print/book.tsx"
import type { site_model, page } from "../../../../engine/load/model.ts"
import { to_html } from "../../../../shared/vnode/vnode.tsx"

const config = await load_config(process.cwd())
function fixture() {
    const node = parse_xml('<window view/>', "fixture.xml")[0]
    node.attrs.type = notebook_mime
    node.attrs.data = JSON.stringify({ nbformat: 4, nbformat_minor: 0, metadata: { never_print_metadata: "keep" }, cells: [
        { cell_type: "markdown", metadata: {}, source: "# Published notebook" },
        { cell_type: "code", metadata: {}, source: "print(1)", execution_count: 1, outputs: [{ output_type: "stream", name: "stdout", text: "1\n" }] },
    ] })
    const page = { path: "/blogs/example", name: "Example", lang: "en", noindex: false, node: { attrs: { print: "book" }, children: [{ tag: "desk", children: [node] }] } } as unknown as page
    const model = { config, pages: [page], resources: new Map(), prints: parse_xml('<print name="book" layout="book" lang="*"/>', "print.xml") } as site_model
    return { ctx: { model, page, lang: "en", expertise: null }, node }
}
test("static notebook windows and book output contain cells and stored results without metadata leakage", () => {
    const { ctx, node } = fixture()
    const html = to_html(render_window_body(ctx, { index: 0, node, label: "Notebook", icon: "" }))
    const document = parseHTML(html).document
    assert.equal(document.querySelector("h1")?.textContent, "Published notebook")
    assert.equal(document.querySelector("code")?.textContent, "print(1)")
    assert.equal(document.querySelector(".notebook_output")?.textContent, "1\n")
    assert(!html.includes("never_print_metadata"))
    const book = to_html(render_book(ctx))
    assert(book.includes("book_notebook") && book.includes("Published notebook"))
    assert.equal(parseHTML(book).document.querySelector(".book_notebook h3")?.textContent, "Published notebook")
    assert(!book.includes("never_print_metadata"))
})
test("malformed published notebooks retain escaped fallback content without constructing active nodes", () => {
    const { ctx, node } = fixture()
    node.attrs.data = '<script>alert(1)</script>'
    const html = to_html(render_window_body(ctx, { index: 0, node, label: "Notebook", icon: "" }))
    assert(html.includes("Unsupported or invalid"))
    assert.equal(parseHTML(html).document.querySelector("script"), null)
    assert(html.includes("&lt;script&gt;"))
})
