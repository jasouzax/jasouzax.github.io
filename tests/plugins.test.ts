import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { plugin_matches, trigger_matches, select_case, type plugin_case } from "../src/plugin_types.ts"
import { compile_plugins } from "../src/plugins.ts"
import { new_diagnostics } from "../src/diag.ts"
import { parse_xml } from "../src/xml.ts"
import type { site_model } from "../src/model.ts"
import { load_site } from "../src/model.ts"
import { load_config } from "../src/config.ts"
import { sha256 } from "../src/util.ts"
import { validate_roots } from "../src/schema.ts"

test("XML bare attributes become true without changing quoted values, comments or CDATA", () => {
    const source = `
        <!-- <case file view> -->
        <plugin id="code" name="file view > edit" version='1'>
            <case file view edit="false" mime="text/*" host="text"/>
            <case file = 'false' error host="default" />
        </plugin>
    <theme name="sample"><style><![CDATA[<case file view> & 'quoted']]></style></theme>`
    const roots = parse_xml(source, "bare.xml")
    const cases = roots[0].children
    assert.deepEqual(cases[0].attrs, { file: "true", view: "true", edit: "false", mime: "text/*", host: "text" })
    assert.deepEqual(cases[1].attrs, { file: "false", error: "true", host: "default" })
    assert.equal(roots[0].attrs.name, "file view > edit")
    assert.equal(roots[1].children[0].text, "<case file view> & 'quoted'")
    assert.equal(cases[0].line, 4)
    const diag = new_diagnostics()
    validate_roots(roots, diag)
    assert.deepEqual(diag.errors, [])
    assert.throws(() => parse_xml('<plugin id="a" id="b"/>', "duplicate.xml"), /duplicate attribute/i)
    assert.throws(() => parse_xml('<plugin id=unquoted/>', "bad.xml"))
    assert.throws(() => parse_xml('<plugin id="unclosed></plugin>', "bad.xml"))
    const invalid = new_diagnostics()
    validate_roots(parse_xml('<plugin id="x" version="1"><case file="yes" host="bogus"/></plugin>', "invalid.xml"), invalid)
    assert.equal(invalid.errors.length, 2)
    const page = parse_xml('<page path="/" name="Home" noindex><desk auto server="false"><window full save="false" flow/></desk></page>', "page.xml")[0]
    assert.equal(page.attrs.noindex, "true")
    assert.deepEqual(page.children[0].children[0].attrs, { full: "true", save: "false", flow: "true" })
})

test("plugin roots compile identically in one file, separate files and nested content folders", async () => {
    const root = mkdtempSync(join(tmpdir(), "jazu_plugin_roots_"))
    try {
        const config = await load_config(process.cwd())
        const definitions = [
            '<plugin id="text" version="1"><case file view host="text"/></plugin>',
            '<plugin id="media" version="1"><case file view host="media"/></plugin>',
            '<plugin id="custom" version="1" script="behavior.js"/>',
        ]
        const script = 'export function render() { return document.createElement("div") }'
        const put = (layout: string, file: string, value: string) => {
            const target = join(root, layout, "content", file)
            mkdirSync(join(target, ".."), { recursive: true })
            writeFileSync(target, value)
        }
        put("combined", "plugins.xml", definitions.join("\n"))
        put("combined", "behavior.js", script)
        put("separate", "a.xml", definitions[0])
        put("separate", "arbitrary/deep/b.xml", definitions[1])
        put("separate", "arbitrary/deep/c.xml", definitions[2])
        put("separate", "arbitrary/deep/behavior.js", script)
        const manifests = []
        for (const layout of ["combined", "separate"]) {
            const diag = new_diagnostics()
            const model = load_site(join(root, layout), config, diag, new Date("2026-11-05"))
            assert.deepEqual(model.plugins.map(node => node.attrs.id), ["text", "media", "custom"])
            manifests.push(await compile_plugins(model, new Map()))
            assert.deepEqual(diag.errors, [])
        }
        assert.deepEqual(manifests[0], manifests[1])
    } finally { rmSync(root, { recursive: true, force: true }) }
})

test("ordered plugin cases reserve exact MIME exclusions before broad matches", () => {
    const cases: plugin_case[] = [
        { file: "true", edit: "true", mime: "text/markdown", host: "text" },
        { file: "true", view: "true", edit: "true", mime: "text/*,application/*+json", host: "text" },
    ]
    const item = { file: new Blob(["source"]), mime: "text/markdown", path: "file:///tmp/test.md", mode: "view" }
    assert.equal(select_case(cases, item), null)
    assert.equal(select_case(cases, { ...item, mode: "edit" }), cases[0])
    assert.equal(select_case(cases, { ...item, mime: "text/javascript" }), cases[1])
    assert.equal(select_case(cases, { ...item, mime: "application/ld+json" }), cases[1])
    assert.equal(select_case(cases, { ...item, mime: "text/javascript", file: null }), null)
    assert.equal(select_case(cases, { ...item, mime: "text/javascript", error: "Not found" }), null)
    const errors: plugin_case[] = [{ error: "true", host: "default" }, { host: "text" }]
    assert.equal(select_case(errors, { ...item, error: "Not found" }), errors[0])
    assert.equal(select_case(errors, item), errors[1])
    const urls: plugin_case[] = [{ url: "/reserved", edit: "true", host: "text" }, { url: "/*", view: "true", host: "media" }]
    assert.equal(select_case(urls, { ...item, path: "/reserved" }), null)
    assert.equal(select_case(urls, { ...item, path: "/other" }), urls[1])
    assert.equal(select_case([{ file: "false", host: "default" }], { ...item, file: null })?.host, "default")
})

test("plugin triggers combine comma lists, wildcard paths and modes literally", () => {
    const plugin = { id: "code", version: "1", mime: "text/*, application/*+json", mode: "view, edit", path: "file:///tmp/*" }
    assert(plugin_matches(plugin, { mime: "text/javascript", mode: "view", path: "file:///tmp/hello.js" }))
    assert(plugin_matches(plugin, { mime: "application/ld+json", mode: "edit", path: "file:///tmp/data.json" }))
    assert(!plugin_matches(plugin, { mime: "image/png", mode: "view", path: "file:///tmp/hello.js" }))
    assert(!trigger_matches("pid:1", "pid:123"))
    assert(trigger_matches("/file[1].js", "/file[1].js"))
    assert(!trigger_matches("/file[1].js", "/file1xjs"))
    assert(plugin_matches({ id: "default", version: "1" }, { mime: "", mode: "", path: "" }))
})

test("plugin build bundles scripts, publishes WASM, and rejects duplicate IDs and escapes", async () => {
    const root = mkdtempSync(join(tmpdir(), "jazu_plugins_"))
    try {
        const content_dir = join(root, "content")
        mkdirSync(join(content_dir, "plugins"), { recursive: true })
        writeFileSync(join(content_dir, "plugins", "helper.js"), "export const label = 'plugin body'")
        writeFileSync(join(content_dir, "plugins", "sample.js"), "import { label } from './helper.js'; export function render() { return label }")
        const bytes = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0])
        writeFileSync(join(content_dir, "plugins", "sample.wasm"), bytes)
        const plugins = parse_xml(`<plugin id="sample" version="1" script="sample.js" wasm="sample.wasm" sha256="${sha256(bytes)}" from="image/png" to="image/jpeg" flow="convert"/><plugin id="sample" version="2"/><plugin id="escape" version="1" script="../../../outside.js"/><plugin id="declarative" version="1"><case file view host="text"/><case edit script="sample.js"/></plugin>`, join(content_dir, "plugins", "sample.xml"))
        const diag = new_diagnostics()
        const model = { root, content_dir, plugins, diag, mode: "development" } as site_model
        const files = new Map()
        const manifest = await compile_plugins(model, files)
        assert.match(manifest[0].script!, /^\/assets\/plugins\/[a-f0-9]+\.js$/)
        assert.match(String(files.get(manifest[0].script!.slice(1))), /plugin body/)
        assert.deepEqual(files.get(manifest[0].wasm!.slice(1)), bytes)
        assert.equal(manifest[0].flow, "convert")
        assert.equal(manifest[0].from, "image/png")
        assert.equal(manifest[2].script, undefined)
        assert.deepEqual(manifest[2].cases![0], { file: "true", view: "true", host: "text" })
        assert.equal(manifest[2].cases![1].script, manifest[0].script)
        assert.equal(diag.errors.length, 2)
        assert.match(JSON.stringify(diag.errors), /duplicate plugin/)
        assert.match(JSON.stringify(diag.errors), /inside content/)
    } finally { rmSync(root, { recursive: true, force: true }) }
})
