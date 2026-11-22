/* Feed privacy, escaping and language isolation are publication boundaries. */
import { test } from "node:test"
import assert from "node:assert/strict"
import { rss_xml } from "../../../engine/routes/blogs/rss.xml.tsx"
import { atom_xml } from "../../../engine/routes/blogs/atom.xml.tsx"
import type { site_model } from "../../../engine/load/model.ts"
import { SaxesParser } from "saxes"

test("RSS and Atom publish safe, language-specific public blog summaries", () => {
    const make = (path: string, lang: string, noindex = false) => ({ path, lang, noindex, name: 'A < B & "C"', info: "<&summary>", node: { attrs: { date: "2026-11-22" } } })
    const model = { config: { base_url: "https://example.com", default_language: "en", site_name: "Site & News", owner: { name: "Owner" } }, build_date: new Date("2026-11-22T00:00:00Z"), pages: [make("/blogs/public", "en"), make("/blogs/hidden", "en", true), make("/blogs/japanese", "ja"), make("/projects/example", "en")] } as unknown as site_model
    for (const xml of [rss_xml(model, "en"), atom_xml(model, "en")]) {
        new SaxesParser({ xmlns: true }).write(xml).close()
        assert(xml.includes("A &lt; B &amp; &quot;C&quot;"))
        assert(xml.includes("https://example.com/blogs/public"))
        for (const hidden of ["hidden", "japanese", "projects/example"]) assert(!xml.includes(hidden))
        assert.equal(xml, xml.includes("<rss") ? rss_xml(model, "en") : atom_xml(model, "en"))
    }
    assert(atom_xml(model, "ja").includes("/ja/blogs/japanese"))
})
