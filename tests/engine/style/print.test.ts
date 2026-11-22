// Regression: the resume markup is emitted [hidden]. The skeleton ships its [hidden] rule inside @layer layout, and a layered !important
// beats any unlayered !important, so print CSS cannot override it: layout.xml must exempt the resume containers and hide them on screen only.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parse_xml } from "../../../shared/content/xml.ts"
import { emit_page_styles } from "../../../engine/style/page.tsx"
import type { site_model, page } from "../../../engine/load/model.ts"
import { new_diagnostics } from "../../../shared/diag.ts"

function rule_body(css: string, selector: string): string {
    const start = css.indexOf(`${selector} {`)
    assert.ok(start >= 0, `rule not found: ${selector}`)
    return css.slice(start, css.indexOf("}", start))
}

test("english resume print css overrides [hidden]", () => {
    const css = readFileSync(new URL("../../../content/portfolio.print.css", import.meta.url), "utf8")
    assert.match(rule_body(css, "body.page_portfolio .expertise_resume"), /display:\s*block\s*!important/)
})

test("rirekisho print css overrides [hidden]", () => {
    const css = readFileSync(new URL("../../../content/portfolio.ja.print.css", import.meta.url), "utf8")
    assert.match(rule_body(css, "body.page_portfolio .rireki"), /display:\s*block\s*!important/)
})

test("skeleton [hidden] rule exempts the resume containers in print", () => {
    const xml = readFileSync(new URL("../../../content/theme/layout.xml", import.meta.url), "utf8")
    assert.match(xml, /\[hidden\]:not\(\.landing_resume\):not\(\.expertise_resume\)\s*\{\s*display:\s*none\s*!important/)
    assert.match(xml, /@media screen\s*\{[^}]*\.landing_resume[^}]*\.expertise_resume[^}]*\[hidden\]/)
})

test("print styles compile SCSS and fonts behind print media and invalidate changed assets", () => {
    const root = mkdtempSync(join(tmpdir(), "jazu-print-")), file = join(root, "print.xml")
    try {
        writeFileSync(join(root, "print.woff2"), "synthetic-font-bytes")
        writeFileSync(join(root, "paper.scss"), "$color: red; body { color: $color; }")
        const prints = parse_xml('<print name="paper" lang="*"><style src="paper.scss"/><font name="Paper" src="print.woff2"/></print>', file)
        const page = { path: "/", lang: "en", node: { attrs: { print: "paper" }, children: [] } } as unknown as page
        const model = { prints, pages: [page], config: { font_formats: ["woff2"] }, mode: "production", diag: new_diagnostics() } as unknown as site_model
        const files = new Map<string, Buffer | string>(), styles = emit_page_styles(model, files).get(page)!
        assert.equal(styles[0].media, "print")
        const css = String(files.get(styles[0].href.slice(1)))
        assert(css.startsWith("@media print{"))
        assert(css.includes("color:red")); assert(css.includes("@font-face"))
        assert([...files.keys()].some(name => name.endsWith(".woff2")))
        writeFileSync(join(root, "print.woff2"), "changed-synthetic-font")
        assert.notEqual(emit_page_styles(model, new Map()).get(page)![0].href, styles[0].href)
        assert.equal(model.diag.errors.length, 0)
    } finally { rmSync(root, { recursive: true, force: true }) }
})
