import { test } from "node:test"
import assert from "node:assert/strict"
import { parseHTML } from "linkedom"
import { jsx, fragment, to_html, serialize, deserialize, to_dom } from "../src/web/vnode.tsx"
import { raw } from "../src/web/markup.tsx"
import { readFileSync, readdirSync, existsSync } from "node:fs"
import { join } from "node:path"
import { load_config } from "../src/config.ts"
import { load_site, ui_text } from "../src/model.ts"
import { new_diagnostics } from "../src/diag.ts"
import { render_page, type page_assets } from "../src/web/html_page.tsx"
import { build_expertise } from "../src/expertise.ts"

test("vnode HTML/DOM renderers preserve text, attributes, SVG and inert template contents", () => {
    const untrusted = '<img src=x onerror="steal()">&'
    const tree = jsx(fragment, null,
        jsx("p", { title: untrusted, "aria-hidden": false }, untrusted),
        jsx("svg", { viewBox: "0 0 20 20" }, jsx("path", { d: "M0 0L20 20" })),
        jsx("template", { id: "test_template" }, jsx("section", { class: "desk_wbox" }, "Window")))
    const html = to_html(tree)
    assert(!html.includes('<img src=x'))
    const { document } = parseHTML("<html><body></body></html>")
    document.body.appendChild(to_dom(deserialize(serialize(tree)), document as unknown as Document) as any)
    assert.equal(document.querySelector("p")!.textContent, untrusted)
    assert.equal(document.querySelector("p")!.getAttribute("title"), untrusted)
    assert.equal(document.querySelector("p")!.getAttribute("aria-hidden"), "false")
    assert.equal(document.querySelector("img"), null)
    assert.equal(document.querySelector("svg")!.getAttribute("viewBox"), "0 0 20 20")
    assert.equal((document.querySelector("template") as any).content.firstElementChild.className, "desk_wbox")
    assert.throws(() => jsx("p", { onclick: "steal()" }), /Event attributes/)
})

test("trusted build markup becomes serializable nodes rather than raw browser HTML", () => {
    const tree = raw('<p>Published <strong>article</strong> &amp; notes</p>')
    assert.match(to_html(tree), /<strong>article<\/strong>/)
    assert(Array.isArray(serialize(tree)))
})

test("config language dictionaries and XML language variants follow the migration contract", async () => {
    const config = await load_config(process.cwd())
    assert(!Array.isArray(config.languages))
    assert(!existsSync("tools"))
    const model = load_site(process.cwd(), config, new_diagnostics(), new Date("2026-11-05"))
    assert.equal(ui_text(model, "en", "home"), config.languages.en.home)
    assert.equal(ui_text(model, "missing", "home"), config.languages.en.home)
    for (const page of model.pages) {
        const variants = model.pages.filter(other => other.path === page.path)
        assert(variants.every(other => other.node.file === page.node.file), `Language variants share a file: ${page.path}`)
    }
})

test("all migrated pages render real elements and JSON vnode payloads without stringifying components", async () => {
    const root = process.cwd(), config = await load_config(root)
    const model = load_site(root, config, new_diagnostics(), new Date("2026-11-05"))
    const assets: page_assets = { themes: Object.fromEntries(model.themes.map(node => [node.attrs.name, {
        name: node.attrs.name, css: "/theme.css", js: null, fonts: [], colors: ["#fff", "#000"], background: node.attrs.background ?? "", label: node.attrs.name
    }])), runtime_page: "/page.js", runtime_theme_switch: "/theme.js", runtime_desk_shell: "/shell.js", boot_script: "", nav_index: "[]", page_styles: new Map() }
    for (const page of model.pages) {
        const rendered = render_page(model, page, assets, { expertise: build_expertise(model, page.lang) })
        assert(!rendered.html.includes("[object Object]"), page.path)
        assert(!rendered.html.includes("jazu_expr_"), page.path)
        const { document } = parseHTML(rendered.html)
        assert.equal(document.querySelector("head > title")?.textContent, document.title, page.path)
        assert(document.querySelector("head > meta[name=description]"), page.path)
        assert.equal(document.querySelectorAll("#head > *").length, 7, page.path)
        assert.equal(document.querySelector("#head_account + #head_language")?.id, "head_language")
        if (page.path === "/") {
            assert.equal(document.querySelector('#head_tabs a[href="#home"]')?.textContent?.trim().endsWith(page.lang === "ja" ? "ホーム" : "Home"), true)
            assert.match(document.querySelector("h1")!.textContent!, /Jason Catalan D'Souza/)
        }
        const payload = rendered.json as any
        assert(Array.isArray(payload.header), page.path)
        assert(Array.isArray(payload.main), page.path)
        assert(!("header_html" in payload) && !("main_html" in payload))
    }
})
