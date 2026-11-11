// Regression: the resume markup is emitted [hidden]. The skeleton ships its [hidden] rule inside @layer layout, and a layered !important
// beats any unlayered !important, so print CSS cannot override it: layout.xml must exempt the resume containers and hide them on screen only.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

function rule_body(css: string, selector: string): string {
    const start = css.indexOf(`${selector} {`)
    assert.ok(start >= 0, `rule not found: ${selector}`)
    return css.slice(start, css.indexOf("}", start))
}

test("english resume print css overrides [hidden]", () => {
    const css = readFileSync(new URL("../content/portfolio.print.css", import.meta.url), "utf8")
    assert.match(rule_body(css, "body.page_portfolio .expertise_resume"), /display:\s*block\s*!important/)
})

test("rirekisho print css overrides [hidden]", () => {
    const css = readFileSync(new URL("../content/portfolio.ja.print.css", import.meta.url), "utf8")
    assert.match(rule_body(css, "body.page_portfolio .rireki"), /display:\s*block\s*!important/)
})

test("skeleton [hidden] rule exempts the resume containers in print", () => {
    const xml = readFileSync(new URL("../content/theme/layout.xml", import.meta.url), "utf8")
    assert.match(xml, /\[hidden\]:not\(\.landing_resume\):not\(\.expertise_resume\)\s*\{\s*display:\s*none\s*!important/)
    assert.match(xml, /@media screen\s*\{[^}]*\.landing_resume[^}]*\.expertise_resume[^}]*\[hidden\]/)
})
