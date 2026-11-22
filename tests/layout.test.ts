import { test } from "node:test"
import assert from "node:assert/strict"
import postcss from "postcss"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { split_layout_css } from "../src/layout_css.ts"
import { headers_file, inline_script_hash } from "../src/web/seo.tsx"

test("component roots import only themselves and shared contracts", () => {
    const root = process.cwd()
    const violations: string[] = []
    const visit = (directory: string, owner: string): void => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            if (["node_modules", "dist", "test", "tests", ".git"].includes(entry.name)) continue
            const file = join(directory, entry.name)
            if (entry.isDirectory()) { visit(file, owner); continue }
            if (!/\.[cm]?[jt]sx?$/.test(entry.name)) continue
            const source = readFileSync(file, "utf8")
            for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s*)["'](\.[^"']+)["']/g)) {
                const target = relative(root, resolve(dirname(file), match[1])).replace(/\\/g, "/").split("/")[0]
                if (target !== owner && target !== "shared") violations.push(`${relative(root, file)} -> ${match[1]}`)
            }
        }
    }
    for (const owner of ["engine", "desk", "cloud", "server", "app", "extension", "shared"]) {
        if (existsSync(join(root, owner))) visit(join(root, owner), owner)
    }
    assert.deepEqual(violations, [])
})

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
    const scripts = headers.match(/script-src ([^;]+)/)![1]
    assert(scripts.includes("'self'") && scripts.includes("'wasm-unsafe-eval'") && scripts.includes(`'sha256-${inline_script_hash("boot()")}'`))
    assert(!scripts.includes("'unsafe-inline'"))
})
