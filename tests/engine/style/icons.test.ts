/* Material glyph coverage and supplementary-plane serialization across generated font formats. */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { create, type Font } from "fontkit"
import { material_icons } from "../../../engine/style/icons.ts"
import { load_config } from "../../../shared/config.ts"
import { load_site } from "../../../engine/load/model.ts"
import { build_font } from "../../../engine/style/font/build.ts"
import { new_diagnostics } from "../../../shared/diag.ts"
import { json_ascii_pua } from "../../../shared/util.ts"

test("Material tokens survive JSON and every theme provides their real generated glyphs", async () => {
    const config = await load_config(process.cwd())
    assert.deepEqual(config.icons, material_icons)
    assert.equal(Object.keys(material_icons).length, 95)
    const icons = Object.values(material_icons).map(hex => Number.parseInt(hex, 16))
    const text = String.fromCodePoint(...icons)
    assert.equal(JSON.parse(json_ascii_pua(JSON.stringify(text))), text)
    assert(icons.every(code => code >= 0xf0000 && code <= 0xffffd))
    const diag = new_diagnostics()
    const model = load_site(process.cwd(), config, diag, new Date("2026-11-22"))
    for (const theme of model.themes.filter(theme => theme.attrs.name)) {
        const font = theme.children.find(node => node.tag === "font" && node.attrs.name === "Jasouza")!
        const output = build_font(model, font, ["woff2"])
        try {
            const decoded = create(readFileSync(join(output.dir, output.files.woff2))) as Font
            for (const code of icons) {
                assert(decoded.hasGlyphForCodePoint(code), `${theme.attrs.name}: U+${code.toString(16)}`)
                assert(decoded.glyphForCodePoint(code).bbox.width > 0)
            }
        } finally { rmSync(output.dir, { recursive: true, force: true }) }
    }
    assert.equal(diag.errors.length, 0)
})
