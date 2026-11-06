import { test } from "node:test"
import assert from "node:assert/strict"
import postcss from "postcss"
import { split_layout_css } from "../src/layout_css.ts"
import { headers_file, inline_script_hash } from "../src/web/seo.tsx"

test("shared geometry keeps responsive state and dependent variables without importing a theme palette", () => {
    const result = split_layout_css(`
        :root { --panel: #0b1322; --g: 2em; --width: calc(20em + var(--g)); }
        body { display: flex; color: white; background: black; }
        @media (orientation: portrait) {
            .window { width: var(--width); border: 2px solid red; padding: 1em; box-shadow: 0 0 4px blue; }
            .window[hidden] { display: none !important; }
        }
        @keyframes enter { from { transform: translateY(1em); opacity: 0; } }
        .window { animation: enter 1s; }
    `)
    const layout = postcss.parse(result.layout), skin = postcss.parse(result.skin)
    const layout_props: string[] = [], skin_props: string[] = []
    layout.walkDecls(decl => { layout_props.push(decl.prop) })
    skin.walkDecls(decl => { skin_props.push(decl.prop) })
    assert(layout_props.includes("--width") && layout_props.includes("--g"))
    assert(!layout_props.includes("--panel"))
    assert(!layout_props.includes("color") && !layout_props.includes("background"))
    assert(layout_props.includes("border-width") && layout_props.includes("border-style"))
    assert.match(result.layout, /@media \(orientation: portrait\)/)
    assert.match(result.layout, /display: none !important/)
    assert(!skin_props.includes("width") && !skin_props.includes("padding"))
    assert(skin_props.includes("color") && skin_props.includes("border"))
    assert(!result.layout.includes("@keyframes"))
    assert.match(result.skin, /@keyframes enter.*transform: translateY\(1em\)/)
})

test("inline styles receive their own CSP hash without permitting arbitrary inline scripts", () => {
    const css = "body{display:flex}"
    const headers = headers_file([inline_script_hash("boot()")], [inline_script_hash(css)])
    assert(headers.includes(`style-src 'self' 'sha256-${inline_script_hash(css)}'`))
    assert(headers.includes(`script-src 'self' 'wasm-unsafe-eval' 'sha256-${inline_script_hash("boot()")}'`))
})
