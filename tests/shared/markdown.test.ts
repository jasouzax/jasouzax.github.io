/* Shared Markdown must preserve document structure without enabling authored HTML or event attributes. */
import { test } from "node:test"
import assert from "node:assert/strict"
import { parseHTML } from "linkedom"
import { markdown_nodes } from "../../shared/markdown.ts"
import { to_html, to_dom } from "../../shared/vnode/vnode.tsx"

test("Markdown renders headings, tight lists, links, tables and fenced source as virtual nodes", () => {
    const source = '# Title\n\n- one\n- **two**\n\n[link](https://example.com)\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n```html\n<div>literal</div>\n```'
    const nodes = markdown_nodes(source)
    const { document } = parseHTML(`<main>${to_html(nodes)}</main>`)
    assert.equal(document.querySelector("h1")!.textContent, "Title")
    assert.equal(document.querySelectorAll("li").length, 2)
    assert.equal(document.querySelector("li p"), null)
    assert.equal(document.querySelector("strong")!.textContent, "two")
    assert.equal(document.querySelector("a")!.getAttribute("href"), "https://example.com")
    assert.equal(document.querySelectorAll("td").length, 2)
    assert.equal(document.querySelector("pre code")!.textContent, "<div>literal</div>\n")
    const root = document.createElement("section")
    root.appendChild(to_dom(nodes, document as unknown as Document))
    assert.equal(root.querySelector("h1")!.textContent, "Title")
    assert.equal(root.querySelectorAll("td").length, 2)
})

test("Markdown leaves raw HTML and unsafe links inert", () => {
    const html = to_html(markdown_nodes('<img src=x onerror=alert(1)>\n\n[unsafe](javascript:alert(1))'))
    const { document } = parseHTML(`<main>${html}</main>`)
    assert.equal(document.querySelector("img"), null)
    assert.equal(document.querySelector("[onerror]"), null)
    assert.equal(document.querySelector('a[href^="javascript:"]'), null)
    assert.match(document.querySelector("main")!.textContent!, /<img src=x onerror=/)
})
