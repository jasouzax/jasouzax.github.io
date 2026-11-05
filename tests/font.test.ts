import { test } from "node:test"
import assert from "node:assert/strict"
import { create, type Font } from "fontkit"
import { encode_font, type font_job } from "../src/font/binary.ts"

const job: font_job = { name: "Migration Test", epoch: 0, cell: [120, 100], formats: ["ttf", "woff", "woff2", "colrv0"],
    palettes: { light: ["#123456", "#abcdef"], dark: ["#eeeeee", "#111111"] }, syms: [
        { codepoint: 65, width: 80, path: "M10 90 L40 10 L70 90 Z", layers: [] },
        { codepoint: 0x1f310, width: null, path: "", layers: [
            { path: "M10 10H90V90H10Z", color: "0" }, { path: "M20 50 C20 10 80 10 80 50 Q50 90 20 50Z", color: "1" },
        ] },
    ] }

test("independent font reader decodes Node-generated TTF, WOFF, WOFF2 and COLRv0", () => {
    for (const [format, bytes] of encode_font(job)) {
        const font = create(bytes) as Font
        assert.equal(font.unitsPerEm, 100, format)
        assert(font.hasGlyphForCodePoint(65), format)
        assert(font.hasGlyphForCodePoint(0x1f310), format)
        assert.equal(font.glyphForCodePoint(65).advanceWidth, 80, format)
        if (format === "colrv0") {
            assert.equal(font.COLR?.version, 0)
            assert.equal(font.CPAL?.numPalettes, 2)
            const layers = font.glyphForCodePoint(0x1f310).layers!
            assert.equal(layers.length, 2)
            assert.equal(layers[0].glyph.bbox.maxY, 90)
            assert(layers[1].glyph.path.commands.length > 5)
        } else {
            assert.equal(font.glyphForCodePoint(65).bbox.minY, 10, format)
            assert.equal(font.glyphForCodePoint(65).bbox.maxY, 90, format)
            assert(font.glyphForCodePoint(0x1f310).path.commands.length > 5, format)
        }
    }
})

test("Node font writer rejects invalid paths, palette indices and unsupported formats", () => {
    assert.throws(() => encode_font({ ...job, formats: ["colrv1"] }), /not implemented/)
    assert.throws(() => encode_font({ ...job, syms: [{ codepoint: 65, width: null, path: "M?invalid", layers: [] }] }), /Invalid glyph/)
    assert.throws(() => encode_font({ ...job, formats: ["colrv0"], syms: [{ codepoint: 65, width: null, path: "", layers: [{ path: "M0 0L10 0L0 10Z", color: "9" }] }] }), /Palette index/)
})
