/* Books follow authored chapter order, published resources and language/privacy boundaries. */
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseHTML } from "linkedom"
import { load_config } from "../../../../shared/config.ts"
import { new_diagnostics } from "../../../../shared/diag.ts"
import { load_site } from "../../../../engine/load/model.ts"
import { render_book, book_chapters } from "../../../../engine/tags/print/book.tsx"
import { book_print_css } from "../../../../engine/style/print/book.ts"
import { to_html, serialize, deserialize } from "../../../../shared/vnode/vnode.tsx"
import { page_hash, dependency_graph } from "../../../../engine/build/graph.ts"

async function fixture(t: { after: (cleanup: () => void) => void }, xml: string) {
    const root = mkdtempSync(join(tmpdir(), "jazu-book-"))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    mkdirSync(join(root, "content"))
    writeFileSync(join(root, "content/blogs.xml"), xml + '<print name="book" lang="*" layout="book"/>')
    writeFileSync(join(root, "content/chapter.md"), "## Authored prose\n\nText **with emphasis**.\n\n<script>never execute</script>")
    writeFileSync(join(root, "content/secret.md"), "PRIVATE FILE MUST NOT APPEAR")
    const config = await load_config(process.cwd()), diag = new_diagnostics()
    const model = load_site(root, config, diag, new Date("2026-11-23"), "production")
    return { model, diag, root }
}

test("nested blogs inherit language and keep sibling-relative routes/resources in authored order", async t => {
    const { model, diag } = await fixture(t, `<blog id="course" name="Course" lang="en" print="book">
      <window type="text/markdown" data="# Course&#10;&#10;Overview"/>
      <blog id="second" name="Second"><window path="chapter.md" type="text/markdown"/></blog>
      <blog id="first" name="First"><blog id="intro" name="Deep intro"><window type="text/plain" data="let x = 1;"/></blog></blog>
      <blog id="private" name="Private" private="true"><window path="secret.md"/><blog id="nested" name="Hidden descendant"/></blog>
    </blog><blog id="other" name="Other"><blog id="intro" name="Unrelated intro"/></blog>`)
    assert.deepEqual(diag.errors, [])
    const page = model.pages.find(page => page.path === "/blogs/course")!
    const ctx = { model, page, lang: "en", expertise: null }
    assert.deepEqual(book_chapters(ctx).map(page => page.path), ["/blogs/course", "/blogs/course/second", "/blogs/course/first", "/blogs/course/first/intro"])
    assert(model.resources.has("/srv/blogs/course/second/chapter.md"))
    assert(![...model.resources.keys()].some(path => path.includes("secret")))
    const tree = render_book(ctx), html = to_html(tree)
    assert.equal(to_html(deserialize(serialize(tree))), html)
    const { document } = parseHTML(html)
    assert.deepEqual([...document.querySelectorAll(".book_chapter > header h2")].map(node => node.textContent), ["Course", "Second", "First", "Deep intro"])
    assert.equal(document.querySelectorAll(".book_contents a").length, 4)
    assert.equal(document.querySelectorAll("h1").length, 1)
    assert.equal(document.querySelector(".book_prose h4")?.textContent, "Authored prose")
    assert(html.includes("with emphasis") && html.includes("let x = 1;"))
    assert(!html.includes("Hidden descendant") && !html.includes("Unrelated intro") && !html.includes("PRIVATE FILE"))
    assert.equal(document.querySelector("script"), null)
    assert.equal(document.querySelectorAll(".desk_wbox").length, 0)
})

test("books are opt-in and exclude translations, noindex pages and volatile executable/network sources", async t => {
    const { model, diag } = await fixture(t, `<blog id="course" name="English" lang="en" print="book">
      <window path="pid:evil"/><window path="https://example.com/private" type="text/markdown"/>
      <blog id="hidden" name="Not indexed" noindex="true"><window type="text/markdown" data="HIDDEN"/></blog>
    </blog><blog id="course" name="Japanese" lang="ja" print="book"><window type="text/markdown" data="日本語"/></blog>`)
    assert.deepEqual(diag.errors, [])
    const page = model.pages.find(page => page.path === "/blogs/course" && page.lang === "en")!
    const ctx = { model, page, lang: "en", expertise: null }
    const html = to_html(render_book(ctx))
    assert(!html.includes("HIDDEN") && !html.includes("日本語") && !html.includes("pid:evil") && !html.includes("example.com/private"))
    const ja = model.pages.find(page => page.lang === "ja" && page.path === "/blogs/course")!
    assert(to_html(render_book({ ...ctx, page: ja, lang: "ja" })).includes("目次"))
    delete page.node.attrs.print
    assert.equal(render_book(ctx), null)
})

test("nested duplicate sibling routes and invalid ancestor segments fail content validation", async t => {
    const { diag } = await fixture(t, '<blog id="course" name="Course"><blog id="intro" name="One"/><blog id="intro" name="Two"/></blog><blog id=".." name="Unsafe"><blog id="child" name="Child"/></blog>')
    assert(diag.errors.some(message => message.includes("duplicate page /blogs/course/intro")))
    assert(diag.errors.filter(message => message.includes("safe URL segment")).length >= 2)
})

test("book paper sizes are constrained and chapter pagination is print-only", () => {
    assert.match(book_print_css(), /size: A5;/)
    assert.match(book_print_css("letter"), /size: letter;/)
    assert.match(book_print_css("invalid; } body { color: red"), /size: A5;/)
    assert(!book_print_css("invalid; } body { color: red").includes("color: red"))
    assert.match(book_print_css(), /break-before: page/)
})

test("book Markdown resolves chapter-relative links and embeds only published images", async t => {
    const { model } = await fixture(t, '<blog id="course" name="Course" print="book"><blog id="chapter" name="Chapter"><window path="chapter.md" type="text/markdown"/></blog></blog>')
    const page = model.pages.find(page => page.path === "/blogs/course")!
    const source = model.resources.get("/srv/blogs/course/chapter/chapter.md")!
    writeFileSync(source, '[Link](next.md) ![Available](picture.svg) ![Missing](missing.png) ![Remote](https://other.example/image.png)')
    model.resources.set("/srv/blogs/course/chapter/picture.svg", source)
    const { document } = parseHTML(to_html(render_book({ model, page, lang: "en", expertise: null })))
    assert.equal(document.querySelector(".book_prose a")?.getAttribute("href"), new URL("/srv/blogs/course/chapter/next.md", model.config.base_url).href)
    assert.equal(document.querySelector(".book_prose img")?.getAttribute("src"), "/srv/blogs/course/chapter/picture.svg")
    assert.equal(document.querySelectorAll(".book_prose img").length, 1)
    assert(document.querySelector("article")?.textContent.includes("Missing"))
})

test("an edited descendant invalidates its book while unrelated articles do not", async t => {
    const { model, root } = await fixture(t, '<blog id="course" name="Course" print="book"><blog id="chapter" name="Chapter"><window path="chapter.md" type="text/markdown"/></blog></blog><blog id="unrelated" name="Unrelated"><window type="text/markdown" data="Unrelated text"/></blog>')
    const book = model.pages.find(page => page.path === "/blogs/course")!
    const unrelated = model.pages.find(page => page.path === "/blogs/unrelated")!
    const before = page_hash(model, book, "shared", ""), other = page_hash(model, unrelated, "shared", "")
    writeFileSync(join(root, "content/chapter.md"), "Revised chapter")
    assert.notEqual(page_hash(model, book, "shared", ""), before)
    assert.equal(page_hash(model, unrelated, "shared", ""), other)
    assert(dependency_graph(model).edges.some(([source, target]) => source === "page:en:/blogs/course/chapter" && target === "page:en:/blogs/course"))
})
