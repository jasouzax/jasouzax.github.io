/** Research printing keeps authored order/escaping, language boundaries and public-only fields. */
import { test } from "node:test"
import assert from "node:assert/strict"
import { parseHTML } from "linkedom"
import { parse_xml } from "../../../../shared/content/xml.ts"
import { to_html, serialize, deserialize } from "../../../../shared/vnode/vnode.tsx"
import { load_config } from "../../../../shared/config.ts"
import type { site_model, page } from "../../../../engine/load/model.ts"
import { render_research_paper } from "../../../../engine/tags/print/research.tsx"
import { research_print_css } from "../../../../engine/style/print/research.ts"

const config = await load_config(process.cwd())
function context(xml: string, lang = "en", print = "research") {
    const model = { config, objects: parse_xml(xml, "research.xml"), prints: parse_xml('<print name="research" lang="*" layout="research"/>', "print.xml") } as site_model
    const page = { path: "/projects/example", lang, node: { attrs: { print } } } as unknown as page
    return { model, page, lang, expertise: null }
}

test("research print renders nested public text in section order and serializes into SPA payloads", () => {
    const ctx = context('<project id="example" name="Authored title" date="Apr 2026" repo="secret-repo" collaborators="secret@example.com"><research><results>Observed result</results><problem>Problem &lt;script&gt;<point name="First point">Nested text<point name="Second point">Deep text</point></point></problem></research></project>')
    const tree = render_research_paper(ctx), html = to_html(tree)
    assert.equal(to_html(deserialize(serialize(tree))), html)
    const { document } = parseHTML(html)
    assert.equal(document.querySelector("h1")?.textContent, "Authored title")
    assert.deepEqual([...document.querySelectorAll("h2")].map(node => node.textContent), ["Problem", "Results"])
    assert.equal(document.querySelectorAll("ol ol li").length, 1)
    assert(html.includes("Deep text"))
    assert(!html.includes("secret-repo") && !html.includes("secret@example.com"))
    assert.equal(document.querySelector("script"), null)
})

test("research print requires opt-in, public project and matching language, without cross-language fallback", () => {
    const xml = '<project id="example" lang="en" name="English only" date="2026"><research><results>Published</results></research></project>'
    assert.equal(render_research_paper(context(xml, "en", "")), null)
    assert.equal(render_research_paper(context(xml, "ja")), null)
    assert.equal(render_research_paper(context(xml.replace('id="example"', 'id="example" private="true"'))), null)
    assert.equal(render_research_paper(context(xml.replace(/<research>.*<\/research>/, ""))), null)
    const ja = to_html(render_research_paper(context(xml.replace('lang="en"', 'lang="ja"'), "ja")))
    assert(ja.includes("結果"))
})

test("research paper size accepts supported formats without interpolating arbitrary CSS", () => {
    assert.match(research_print_css("letter"), /size: letter;/)
    assert.match(research_print_css("A5"), /size: A5;/)
    assert.match(research_print_css("x;}body{display:none"), /size: A4;/)
    assert(!research_print_css("x;}body{display:none").includes("x;}"))
})

test("research source links omit credentials and executable URLs", () => {
    for (const paper of ["https://private:secret@example.com/paper", "javascript:alert(1)", "not a URL"]) {
        const ctx = context(`<project id="example" name="Study" date="2026" paper="${paper}"><research><results>Published.</results></research></project>`)
        const html = to_html(render_research_paper(ctx))
        assert(!html.includes('href='))
        assert(!html.includes('private:secret'))
    }
})
