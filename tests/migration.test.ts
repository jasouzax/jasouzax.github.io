import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, cpSync, rmSync, unlinkSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { execFileSync } from "node:child_process"
import { load_config } from "../src/config.ts"
import { load_site } from "../src/model.ts"
import { new_diagnostics } from "../src/diag.ts"
import { select_print, print_person } from "../src/prints.ts"
import { resolve_request, serve } from "../src/node/serve.ts"
import { output_directory, output_file } from "../src/paths.ts"
import { build_site } from "../src/build.ts"
import { build_expertise, scss_data } from "../src/expertise.ts"
import { memory_directory } from "../src/web/client/memory_fs.ts"
import { build_font } from "../src/font_build.ts"
import { render_expertise } from "../src/web/html_expertise.tsx"
import { to_html } from "../src/web/vnode.tsx"
import { parseHTML } from "linkedom"

function fixture() {
    const root = mkdtempSync(join(tmpdir(), "jazu_test_"))
    const put = (name: string, text: string) => { mkdirSync(resolve(root, name, ".."), { recursive: true }); writeFileSync(join(root, name), text) }
    put("config.json", JSON.stringify({ base_url: "https://example.com", languages: { en: {} }, default_language: "en", themes: ["basic"], default_theme: "basic" }))
    put("content/anywhere.xml", `<page path="/" name="Home"><hero name="Published Name"><item print="email" text="public@example.com"/></hero><expertise><skill name="web"/></expertise></page>`)
    put("content/theme/basic.xml", `<theme name="basic"><style><![CDATA[body {color: black}]]></style></theme>`)
    return { root, put, close: () => rmSync(root, { recursive: true, force: true }) }
}

test("free-form roots generate pages and never publish private projects/slides", async () => {
    const f = fixture()
    try {
        f.put("content/arbitrary/nested.xml", `<project id="public" name="Public" date="2026"><slide skill="web" description="public description"/><slide skill="web" private="true" media="secret.png" description="secret slide"/></project><project id="hidden" name="Secret Project" private="true" date="2026"><window path="secret.txt"/></project>` )
        f.put("content/blogs/post.xml", `<blog id="post" name="Article"><window path="article.md" type="text/markdown"/></blog>`)
        f.put("content/blogs/article.md", "# Public article")
        f.put("content/arbitrary/secret.txt", "must never publish")
        const diag = new_diagnostics()
        const model = load_site(f.root, await load_config(f.root), diag, new Date("2026-11-04"))
        assert.deepEqual(diag.errors, [])
        assert(model.pages.some(page => page.path === "/projects/public"))
        assert(model.pages.some(page => page.path === "/blogs/post"))
        assert(!model.pages.some(page => page.path.includes("hidden")))
        assert(!JSON.stringify(model.objects.map(node => node.attrs)).includes("Secret Project"))
        assert(!model.objects.flatMap(node => node.children).some(node => node.attrs.description === "secret slide"))
        assert.equal(model.resources.get("/srv/blogs/post/article.md"), join(f.root, "content/blogs/article.md"))
        assert(![...model.resources.values()].some(file => file.endsWith("secret.txt")))
    } finally { f.close() }
})

test("resource escapes and unsafe page paths are validation errors", async () => {
    const f = fixture()
    try {
        f.put("content/unsafe.xml", `<page path="/../../outside" name="Bad"><desk><window path="../../outside.md"/></desk></page>`)
        const diag = new_diagnostics()
        load_site(f.root, await load_config(f.root), diag, new Date("2026-11-04"))
        assert(diag.errors.some(error => error.includes("page path")))
        assert(diag.errors.some(error => error.includes("escapes content")))
    } finally { f.close() }
})

test("print language matching chooses exact then prefix then wildcard, using published personal data", async () => {
    const f = fixture()
    try {
        f.put("content/prints.xml", `<print name="resume"/><print name="resume" lang="en*" size="a4"/><print name="resume" lang="en" size="letter"/>`)
        const model = load_site(f.root, await load_config(f.root), new_diagnostics(), new Date("2026-11-04"))
        const home = model.pages.find(page => page.path === "/")!
        home.node.attrs.print = "resume"
        assert.equal(select_print(model, home)?.attrs.size, "letter")
        assert.equal(select_print(model, { ...home, lang: "en-US" })?.attrs.size, "a4")
        assert.equal(select_print(model, { ...home, lang: "ja" })?.attrs.size, undefined)
        assert.deepEqual(print_person(model, home).attrs, { name: "Published Name", photo: "", email: "public@example.com" })
        assert(build_expertise(model, "en")!.range.expertise.every(Number.isFinite))
    } finally { f.close() }
})

test("output/HTTP paths reject traversal, dotfiles, malformed escapes and accidental source cleanup", () => {
    const f = fixture()
    try {
        for (const path of [".", "content", "src/out", "../outside", ".git"]) assert.throws(() => output_directory(f.root, path))
        f.put("dist/index.html", "Home")
        f.put("dist/.env", "secret")
        for (const path of ["/../config.json", "/%2e%2e/config.json", "/.env", "/%zz", "/..\\config.json"]) assert.equal(resolve_request(join(f.root, "dist"), path), null)
        assert.equal(resolve_request(join(f.root, "dist"), "/"), join(f.root, "dist/index.html"))
    } finally { f.close() }
})

test("project skill variants preserve distinct descriptions/media and select the featured fallback", async () => {
    const f = fixture()
    try {
        f.put("content/anywhere.xml", `<page path="/" name="Home"><hero name="Owner"/><expertise><skill name="web"/><skill name="cloud"/><skill name="iot"/></expertise></page>`)
        f.put("content/project.xml", `<project id="tracker" name="Tracker" date="2026" featured="true"><slide skill="web, cloud" info="Dashboard" media="web.svg"/><slide skill="iot" info="Sensor hardware" featured="true" media="iot.svg"/></project>`)
        f.put("content/web.svg", '<svg xmlns="http://www.w3.org/2000/svg"/>')
        f.put("content/iot.svg", '<svg xmlns="http://www.w3.org/2000/svg"><path/></svg>')
        const model = load_site(f.root, await load_config(f.root), new_diagnostics(), new Date("2026-11-04"))
        const data = build_expertise(model, "en")!
        const web = data.entries.find(entry => entry.states.includes("web"))!
        const iot = data.entries.find(entry => entry.states.includes("iot"))!
        assert.equal(web.desc, "Dashboard")
        assert.equal(iot.desc, "Sensor hardware")
        assert.notEqual(web.media, iot.media)
        assert(!web.states.includes("expertise"))
        assert(iot.states.includes("expertise"))
        assert(web.states.includes("cloud"))
        assert.equal(model.pages.find(page => page.path === "/projects/tracker")!.info, "Sensor hardware")
        assert.equal((scss_data(data).match(/"tracker":/g) ?? []).length, 1)
        const page = model.pages.find(page => page.path === "/")!
        const node = page.node.children.find(node => node.tag === "expertise")!
        const { document } = parseHTML(to_html(render_expertise({ model, page, lang: "en", expertise: data }, node, data)))
        const slides = [...document.querySelectorAll(".slide")]
        assert.equal(slides.length, 1)
        const variants = [...slides[0].querySelectorAll(".slide_variant")]
        assert.equal(variants.length, 2)
        for (const slide of variants) {
            assert.deepEqual([...slide.querySelectorAll(".slide_skill")].map(link => link.getAttribute("href")), ["#web/tracker", "#cloud/tracker", "#iot/tracker"])
            assert.equal(slide.querySelectorAll('.slide_skill[aria-current="true"]').length, 1)
        }
        const pins = [...document.querySelectorAll("[id]")].map(node => node.id)
        assert.equal(new Set(pins).size, pins.length)
        assert.equal(document.querySelectorAll(".dot.d_tracker").length, 1)
        assert.equal(document.querySelectorAll(".tl_pin.p_tracker").length, 1)
    } finally { f.close() }
})

test("temporary filesystem handles write only in memory and do not survive a new session", async () => {
    const tmp = memory_directory("tmp")
    const file = await tmp.getFileHandle("private.txt", { create: true })
    const writable = await file.createWritable!()
    await writable.write("Private upload")
    await writable.close()
    assert.equal(await (await file.getFile()).text(), "Private upload")
    const another_session = memory_directory("tmp")
    await assert.rejects(another_session.getFileHandle("private.txt"), /Not found/)
    await assert.rejects(tmp.getFileHandle("../private.txt", { create: true }), /Invalid name/)
    await tmp.removeEntry("private.txt")
    await assert.rejects(tmp.getFileHandle("private.txt"), /Not found/)
})

test("resource and output junctions cannot escape their publication roots", async () => {
    const f = fixture()
    try {
        f.put("private/secret.md", "private")
        mkdirSync(join(f.root, "dist"))
        symlinkSync(join(f.root, "private"), join(f.root, "content/escape"), process.platform === "win32" ? "junction" : "dir")
        symlinkSync(join(f.root, "private"), join(f.root, "dist/escape"), process.platform === "win32" ? "junction" : "dir")
        f.put("content/blogs/article.xml", `<blog id="unsafe" name="Unsafe"><window path="../escape/secret.md"/></blog>`)
        const diag = new_diagnostics()
        const model = load_site(f.root, await load_config(f.root), diag, new Date("2026-11-04"))
        assert(diag.errors.some(error => error.includes("symlink escapes")))
        assert.equal(model.resources.size, 0)
        assert.throws(() => output_file(join(f.root, "dist"), "escape/new.md"), /junction escapes/)
    } finally { f.close() }
})

test("custom font output is deterministic for a pinned build date", async () => {
    const f = fixture()
    const temporary: string[] = []
    try {
        f.put("content/theme/font.xml", `<theme name="font_test"><font name="test_font" size="60x100"><sym char="a" path="M0 0 L60 0 L30 100 Z"/></font></theme>`)
        const model = load_site(f.root, await load_config(f.root), new_diagnostics(), new Date("2026-11-04"))
        const font = model.themes.find(node => node.attrs.name === "font_test")!.children[0]
        const first = build_font(model, font, ["woff2"])
        temporary.push(first.dir)
        const second = build_font(model, font, ["woff2"])
        temporary.push(second.dir)
        assert.deepEqual(readFileSync(join(first.dir, first.files.woff2)), readFileSync(join(second.dir, second.files.woff2)))
    } finally { for (const dir of temporary) rmSync(dir, { recursive: true, force: true }); f.close() }
})

test("builds repair JSON, invalidate inline layout and article changes, and prune deleted/private routes", async () => {
    const f = fixture()
    try {
        cpSync(resolve("src"), join(f.root, "src"), { recursive: true })
        symlinkSync(resolve("node_modules"), join(f.root, "node_modules"), "junction")
        f.put("content/blogs/article.xml", `<blog id="post" name="Article"><window path="article.md" type="text/markdown"/></blog>`)
        f.put("content/blogs/article.md", "# First article")
        f.put("content/theme/layout.xml", '<theme><style><![CDATA[body { --inline-version: 1; }]]></style></theme>')
        const options = { root: f.root, out: join(f.root, "dist"), mode: "production" as const, force: false, build_date: new Date("2026-11-04"), only_check: false }
        const first = await build_site(options)
        assert.match(readFileSync(join(options.out, "blogs/post/index.html"), "utf8"), /First article/)
        const second = await build_site(options)
        assert.equal(second.skipped, first.pages)
        const audit = execFileSync(process.execPath, [resolve("src/main.ts"), "icons", "check", "--root", f.root, "--date", "2026-11-04"], { encoding: "utf8", windowsHide: true })
        assert.match(audit, /icons audit/)
        unlinkSync(join(options.out, "blogs/post/index.json"))
        f.put("content/theme/layout.xml", '<theme><style><![CDATA[body { --inline-version: 2; }]]></style></theme>')
        const layout_change = await build_site(options)
        assert.equal(layout_change.skipped, 0, "inline layout changes invalidate every HTML page")
        assert.match(readFileSync(join(options.out, "index.html"), "utf8"), /--inline-version:\s*2/)
        const manifest = JSON.parse(readFileSync(join(options.out, "assets/themes/manifest.json"), "utf8"))
        assert.deepEqual(Object.keys(manifest), ["basic"], "the unnamed theme is never selectable")
        assert(existsSync(join(options.out, "blogs/post/index.json")))
        f.put("content/blogs/article.md", "# Changed article")
        await build_site(options)
        assert.match(readFileSync(join(options.out, "blogs/post/index.html"), "utf8"), /Changed article/)
        f.put("dist/owner.txt", "keep")
        unlinkSync(join(f.root, "content/blogs/article.xml"))
        await build_site(options)
        assert(!existsSync(join(options.out, "blogs/post/index.html")))
        assert(!existsSync(join(options.out, "blogs/post/index.json")))
        assert(!existsSync(join(options.out, "srv/blogs/post/article.md")))
        assert(existsSync(join(options.out, "owner.txt")))
        const server = serve(options.out, 0)
        await new Promise<void>(done => server.once("listening", done))
        try {
            const address = server.address() as { port: number }
            const response = await fetch(`http://127.0.0.1:${address.port}/`)
            assert.equal(response.status, 200)
            assert.match(await response.text(), /Published Name/)
            assert.equal((await fetch(`http://127.0.0.1:${address.port}/missing`)).status, 404)
        } finally { await new Promise<void>((done, fail) => server.close(error => error ? fail(error) : done())) }
    } finally { f.close() }
})
