import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, cpSync, rmSync, unlinkSync, symlinkSync, renameSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { execFileSync } from "node:child_process"
import { load_config } from "../src/config.ts"
import { shared_hash } from "../src/graph.ts"
import { configured_resource } from "../src/resources.ts"
import { icon_source } from "../src/web/seo_images.tsx"
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
import { parse_xml } from "../src/xml.ts"
import { validate_roots } from "../src/schema.ts"
import { research_sections } from "../src/schema.ts"
import { render_desk } from "../src/web/html_desk.tsx"

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
        f.put("content/project.xml", `<project id="tracker" name="Tracker" date="2026" featured="true" website="https://example.com/app" source="https://example.com/source" paper="https://example.com/paper" event="https://example.com/event"><action text="Documentation" link="https://example.com/docs"/><slide skill="web, cloud" info="Dashboard" media="web.svg"/><slide skill="iot" info="Sensor hardware" featured="true" media="iot.svg"/></project>`)
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
        for (const item of [web, iot]) {
            assert.equal(item.website, "https://example.com/app")
            assert.equal(item.source, "https://example.com/source")
            assert.equal(item.paper, "https://example.com/paper")
            assert.equal(item.event, "https://example.com/event")
            assert.equal(item.actions?.[0].link, "https://example.com/docs")
        }
        assert.equal(model.pages.find(page => page.path === "/projects/tracker")!.info, "Sensor hardware")
        assert.equal((scss_data(data).match(/"tracker":/g) ?? []).length, 1)
        const page = model.pages.find(page => page.path === "/")!
        const node = page.node.children.find(node => node.tag === "expertise")!
        const { document } = parseHTML(to_html(render_expertise({ model, page, lang: "en", expertise: data }, node, data)))
        const slides = [...document.querySelectorAll(".slide")]
        assert.equal(slides.length, 1)
        const variants = [...slides[0].querySelectorAll(".slide_variant")]
        assert.equal(variants.length, 2)
        const slide = slides[0]
        assert.deepEqual([...slide.querySelectorAll(".slide_skill")].map(link => link.getAttribute("href")), ["#web/tracker", "#cloud/tracker", "#iot/tracker"])
        assert.equal(slide.querySelectorAll('.slide_skill[aria-current="true"]').length, 1)
        for (const name of [".slide_name", ".slide_role", ".slide_date", ".slide_skills", ".slide_actions"]) {
            assert.equal(slide.querySelectorAll(name).length, 1)
            assert.equal(slide.querySelectorAll(`.slide_variant ${name}`).length, 0)
        }
        assert.equal(slide.querySelectorAll(".slide_actions a").length, 5)
        assert.equal(slide.querySelector('.slide_actions a[href="https://example.com/docs"]')!.textContent, "Documentation")
        const pins = [...document.querySelectorAll("[id]")].map(node => node.id)
        assert.equal(new Set(pins).size, pins.length)
        assert.equal(document.querySelectorAll(".dot.d_tracker").length, 1)
        assert.equal(document.querySelectorAll(".tl_pin.p_tracker").length, 1)
    } finally { f.close() }
})

test("project actions belong to the project rather than its skill variations", () => {
    const diag = new_diagnostics()
    validate_roots(parse_xml(`<project id="example" name="Example" date="2026" website="https://example.com"><action text="Docs" link="https://example.com/docs"/><slide skill="web"/></project>`, "project.xml"), diag)
    assert.deepEqual(diag.errors, [])
    for (const key of ["website", "source", "paper", "event"]) {
        const invalid = new_diagnostics()
        validate_roots(parse_xml(`<project id="example" name="Example" date="2026"><slide skill="web" ${key}="https://example.com"/></project>`, "project.xml"), invalid)
        assert(invalid.errors.some(message => message.includes(`unknown attribute "${key}"`)))
    }
    const invalid = new_diagnostics()
    validate_roots(parse_xml(`<project id="example" name="Example" date="2026"><slide skill="web"><action text="Docs" link="https://example.com/docs"/></slide></project>`, "project.xml"), invalid)
    assert(invalid.errors.some(message => message.includes("<action> is not allowed inside <slide>")))
})

test("project research compiles to ordered, nested explanations without actions", async () => {
    const f = fixture()
    try {
        f.put("content/research.xml", `<project id="study" name="Study" date="2026"><research><results>No findings yet.</results><terminology>Working name &amp; motto.</terminology><problem>Problem body.<point name="Access">Access body.<point name="Cost">Cost body.</point></point></problem></research></project>`)
        const diag = new_diagnostics()
        const model = load_site(f.root, await load_config(f.root), diag, new Date("2026-11-07"))
        assert.deepEqual(diag.errors, [])
        const page = model.pages.find(page => page.path === "/projects/study")!
        const desk = page.node.children[0]
        assert.deepEqual(desk.children.filter(node => node.tag === "menu").map(node => node.attrs.name), ["Files", "Overview", "Version"])
        const overview = desk.children.find(node => node.attrs.name === "Overview")!
        assert.deepEqual(overview.children.map(node => node.attrs.name), Object.values(research_sections))
        assert.equal(overview.children[0].attrs.data, "Working name & motto.")
        assert.equal(overview.children[0].children.length, 0)
        assert.equal(overview.children[1].children[0].children[0].attrs.data, "Cost body.")
        const { document } = parseHTML(to_html(render_desk({ model, page, lang: page.lang, expertise: null }, desk)))
        const panel = document.querySelectorAll(".desk_side_page")[1]
        assert.equal(panel.querySelectorAll(":scope > .desk_side_item").length, 9)
        assert.equal(panel.querySelectorAll("a,button,[data-path]").length, 0)
        assert.match(panel.textContent!, /Problem body/)
        assert.match(panel.textContent!, /Cost body/)
        assert(!model.pages.find(page => page.path === "/projects")!.node.children[0].children.some(node => node.attrs.name === "Overview"))
    } finally { f.close() }
})

test("research validates section structure, nesting and display-only content", () => {
    for (const research of [
        '<research><terminology><point name="Invalid">No children here.</point></terminology></research>',
        '<research><problem link="/desk">No links.</problem></research>',
        '<research><solution><point name="Invalid" acts="Open">No actions.</point></solution></research>',
        '<research><problem>One</problem><problem>Two</problem></research>',
        '<research/><research/>',
    ]) {
        const diag = new_diagnostics()
        validate_roots(parse_xml(`<project id="study" name="Study" date="2026">${research}</project>`, "research.xml"), diag)
        assert(diag.errors.length > 0, research)
    }
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


test("content folders can be renamed using only XML and config changes", async () => {
    const f = fixture()
    try {
        cpSync(resolve("src"), join(f.root, "src"), { recursive: true })
        symlinkSync(resolve("node_modules"), join(f.root, "node_modules"), "junction")
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M1 1L19 19" stroke="currentColor"/></svg>'
        f.put("content/assets/drawing.svg", svg)
        f.put("content/assets/mark.svg", svg.replace('M1 1L19 19', 'M1 19L19 1'))
        f.put("content/assets/tab.svg", svg.replace('M1 1L19 19', 'M1 1L19 1L19 19Z'))
        f.put("content/media/photo.svg", svg)
        f.put("content/media/unpublished.txt", "local archive")
        f.put("content/blogs/post.xml", '<blog id="post" name="Article"><window path="article.md" type="text/markdown"/></blog>')
        f.put("content/blogs/article.md", "# Department-managed article")
        const write_home = (folder: string) => f.put("content/sections/nested/home.xml", `<page path="/" name="Home" image="/${folder}/photo.svg"><hero name="Owner"/></page>`)
        unlinkSync(join(f.root, "content/anywhere.xml"))
        write_home("media")
        const config = JSON.parse(readFileSync(join(f.root, "config.json"), "utf8"))
        const write_config = (assets: string, media: string) => {
            config.resources = { signature: `/${assets}/drawing.svg`, icon: `${assets}/mark.svg`, favicon: `/${assets}/tab.svg` }
            config.pack = { exclude: [`content/${media}`] }
            f.put("config.json", JSON.stringify(config))
        }
        write_config("assets", "media")
        const options = { root: f.root, out: join(f.root, "dist"), mode: "production" as const, force: false, build_date: new Date("2026-11-09"), only_check: false }
        const first = await build_site(options)
        assert.deepEqual(first.diag.errors, [])
        const icons = ["icon.svg", "favicon.ico", "apple-touch-icon.png", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png"]
        const before = icons.map(name => readFileSync(join(options.out, name)))
        for (const [old, next] of [["assets", "signatures"], ["media", "medias"], ["blogs", "articles"], ["theme", "skins"]]) {
            renameSync(join(f.root, "content", old), join(f.root, "content", next))
        }
        write_home("medias")
        write_config("signatures", "medias")
        const second = await build_site(options)
        assert.deepEqual(second.diag.errors, [])
        assert(!second.diag.warnings.some(warning => /missing|belong|unsafe/.test(warning)), second.diag.warnings.join("\n"))
        icons.forEach((name, index) => assert(readFileSync(join(options.out, name)).equals(before[index]), name))
        const { document } = parseHTML(readFileSync(join(options.out, "index.html"), "utf8"))
        assert.equal(document.querySelector("#head_path_logo")?.localName, "svg")
        assert.match(readFileSync(join(options.out, "blogs/post/index.html"), "utf8"), /Department-managed article/)
        assert.match(readFileSync(join(options.out, "llms-full.txt"), "utf8"), /Department-managed article/)
        const image = second.model.pages.find(page => page.path === "/")!.node.attrs.image
        assert(second.model.resources.get(image)?.endsWith(join("medias", "photo.svg")))
        assert(existsSync(join(options.out, image.slice(1))))
        let hash = shared_hash(second.model, "")
        for (const name of ["drawing.svg", "mark.svg", "tab.svg"]) {
            const file = join(f.root, "content/signatures", name)
            writeFileSync(file, readFileSync(file, "utf8").replace("</svg>", "<!-- updated artwork --></svg>"))
            const next = shared_hash(second.model, "")
            assert.notEqual(next, hash, `${name} changes invalidate page output`)
            hash = next
        }
        execFileSync(process.execPath, [resolve("src/main.ts"), "pack", "--root", f.root, "--out_file", "source.zip"], { stdio: "pipe", windowsHide: true })
        const archive = readFileSync(join(f.root, "source.zip"))
        assert(archive.includes(Buffer.from("content/signatures/mark.svg")))
        assert(archive.includes(Buffer.from("content/articles/article.md")))
        assert(!archive.includes(Buffer.from("content/medias/unpublished.txt")))

    } finally { f.close() }
})


test("website artwork uses configured paths and rejects resources outside content", async () => {
    const f = fixture()
    try {
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"/>'
        f.put("content/assets/signature.svg", svg)
        const config = await load_config(f.root)
        let model = load_site(f.root, config, new_diagnostics(), new Date())
        assert.equal(icon_source(model), null, "conventional filenames are never discovered implicitly")
        config.resources.icon = "/assets/signature.svg"
        model = load_site(f.root, config, new_diagnostics(), new Date())
        assert.equal(icon_source(model), join(f.root, "content/assets/signature.svg"))
        f.put("private/secret.svg", svg)
        config.resources.icon = "../private/secret.svg"
        model = load_site(f.root, config, new_diagnostics(), new Date())
        assert.equal(configured_resource(model, "icon"), null)
        assert(model.diag.warnings.some(warning => warning.includes("resources.icon")))
        symlinkSync(join(f.root, "private"), join(f.root, "content/linked"), process.platform === "win32" ? "junction" : "dir")
        config.resources.icon = "/linked/secret.svg"
        model = load_site(f.root, config, new_diagnostics(), new Date())
        assert.equal(configured_resource(model, "icon"), null)
        assert(model.diag.warnings.some(warning => warning.includes("resources.icon")))
    } finally { f.close() }
})
