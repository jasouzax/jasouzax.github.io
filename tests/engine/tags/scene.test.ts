/* Scene contracts cover validation, safe publication, nested reading and shared frame timing. */
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseHTML } from "linkedom"
import { load_config } from "../../../shared/config.ts"
import { new_diagnostics } from "../../../shared/diag.ts"
import { load_site } from "../../../engine/load/model.ts"
import { render_desk } from "../../../engine/tags/desk.tsx"
import { window_infos } from "../../../engine/tags/window.tsx"
import { scene_timeline } from "../../../engine/tags/scene.tsx"
import { render_book } from "../../../engine/tags/print/book.tsx"
import { to_html, serialize, deserialize } from "../../../shared/vnode/vnode.tsx"
import { make_timeline, scene_at, type Scene } from "../../../shared/blog/timeline.ts"
import { page_hash } from "../../../engine/build/graph.ts"

async function fixture(t: { after: (callback: () => void) => void }, content: string) {
    const root = mkdtempSync(join(tmpdir(), "jazu-scenes-"))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    mkdirSync(join(root, "content"))
    writeFileSync(join(root, "content/blog.xml"), content)
    writeFileSync(join(root, "content/sample.md"), "# Published source\n\nAuthored text")
    writeFileSync(join(root, "content/picture.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>')
    writeFileSync(join(root, "content/sound.wav"), "fixture")
    const diag = new_diagnostics(), config = await load_config(process.cwd())
    const model = load_site(root, config, diag, new Date("2026-11-23"))
    const page = model.pages.find(page => page.path === "/blogs/course")!
    return { model, diag, ctx: { model, page, lang: page.lang, expertise: null }, root }
}

test("nested scenes render semantic headings, readable windows, safe JSON and a print projection", async t => {
    const { ctx, diag } = await fixture(t, `<blog id="course" name="Course" print="book"><scene name="First" script="&lt;/script&gt;" duration="1.5"><window path="sample.md" type="text/markdown"/><scene name="Second"><window type="text/plain" data="source code"/><window split="1" type="text/plain"/></scene></scene></blog><print name="book" lang="*" layout="book"/>`)
    assert.deepEqual(diag.errors, [])
    const desk = ctx.page.node.children[0], tree = render_desk(ctx, desk), html = to_html(tree)
    assert.equal(to_html(deserialize(serialize(tree))), html)
    const { document } = parseHTML(html)
    assert.equal(document.querySelector(".blog_scene_heading h2")?.textContent, "First")
    assert.equal(document.querySelector(".blog_scene_heading h3")?.textContent, "Second")
    assert.equal(document.querySelectorAll(".desk > .desk_wbox").length, 3)
    assert(html.includes("Authored text"))
    assert.equal(JSON.parse(document.querySelector("[data-blog-timeline]")!.textContent!).segments[0].text, "</script>\n\n# Published source\n\nAuthored text")
    assert.equal(document.querySelectorAll("script").length, 2)
    assert.equal(window_infos(ctx, desk)[2].node.attrs.split, "2")
    const book = parseHTML(to_html(render_book(ctx))).document
    assert(book.querySelector(".book_chapter")?.textContent.includes("source code"))
    assert.equal(book.querySelector(".blog_scene_heading h4")?.textContent, "Second")
})

test("media projections publish local assets, omit network/runtime sources and invalidate on source edits", async t => {
    const { ctx, diag, root } = await fixture(t, `<blog id="course" name="Course"><scene name="Media" image="picture.svg" audio="sound.wav"><window path="sample.md"/><window path="https://example.com/private.md" type="text/markdown"/><window path="pid:123"/><scene name="Remote" image="https://other.example/image.png"/></scene></blog><blog id="secret" name="Secret" private><scene name="Never published" script="SECRET"/></blog>`)
    assert.deepEqual(diag.errors, [])
    const timeline = scene_timeline(ctx, ctx.page.node.children[0])
    assert.match(timeline.segments[0].image!, /^\/assets\/media\//)
    assert.match(timeline.segments[0].audio!, /^\/assets\/media\//)
    assert.equal(timeline.segments[1].image, undefined)
    assert(!JSON.stringify(timeline).includes("private.md"))
    assert(!JSON.stringify(timeline).includes("SECRET"))
    const before = page_hash(ctx.model, ctx.page, "fixed", "")
    writeFileSync(join(root, "content/sample.md"), "Changed published scene")
    assert.notEqual(page_hash(ctx.model, ctx.page, "fixed", ""), before)
})

test("scene vocabulary rejects invalid duration, colors, unsafe media and illegal parents", async t => {
    const { diag } = await fixture(t, `<blog id="course" name="Course"><scene name="Bad" duration="NaN" color="red;{}" audio="javascript:evil()"/><scene name="Zero" duration="0"/><scene name="Huge" duration="601"/></blog><page path="/" name="Home"><scene name="Misplaced"/></page>`)
    assert.equal(diag.errors.filter(error => error.includes("scene duration")).length, 3)
    assert(diag.errors.some(error => error.includes("scene color")))
    assert(diag.errors.some(error => error.includes("unsafe URI")))
    assert(diag.errors.some(error => error.includes("not allowed inside <page>")))
})

test("scene timing is deterministic at boundaries, seeks and invalid inputs", () => {
    const scene: Scene = { name: "First", text: "", duration: 1.5, background: "#000000", color: "#ffffff" }
    const timeline = make_timeline("Title", [scene, { ...scene, name: "Second", duration: 2 }])
    assert.equal(timeline.duration, 3.5)
    assert.equal(scene_at(timeline, -1)?.name, "First")
    assert.equal(scene_at(timeline, NaN)?.name, "First")
    assert.equal(scene_at(timeline, 1.499)?.name, "First")
    assert.equal(scene_at(timeline, 1.5)?.name, "Second")
    assert.equal(scene_at(timeline, 500)?.name, "Second")
    assert.equal(scene_at(make_timeline("Empty", []), 0), null)
    assert.throws(() => make_timeline("Bad", [{ ...scene, duration: 0 }]))
    assert.throws(() => make_timeline("Bad", Array.from({ length: 7 }, () => ({ ...scene, duration: 600 }))))
})
