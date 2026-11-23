/* Public pipeline UI extends desks while executable policy stays server-only. */
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { load_config } from "../../../../shared/config.ts"
import { new_diagnostics } from "../../../../shared/diag.ts"
import { parse_xml } from "../../../../shared/content/xml.ts"
import { validate_roots } from "../../../../shared/content/schema.ts"
import { parse_pipeline } from "../../../../shared/content/pipeline.ts"
import { load_site } from "../../../../engine/load/model.ts"
import { render_desk } from "../../../../engine/tags/desk.tsx"
import { to_html } from "../../../../shared/vnode/vnode.tsx"

test("pipeline menus, windows and action links join public desks without exposing execution policy", async t => {
    const root = mkdtempSync(join(tmpdir(), "jazu-pipeline-ui-"))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    mkdirSync(join(root, "content"))
    writeFileSync(join(root, "content/report.md"), "Published report")
    writeFileSync(join(root, "content/project.xml"), `<project id="example" name="Example" date="2026" lang="en">
      <window type="text/plain" data="Project window"/>
      <pipeline branch="staging">
        <step name="Private policy" command="internal-deploy-command" args='["private-argument"]' phase="deploy" credentials="TOP_SECRET_DEPLOY"/>
        <menu name="Build documents"><entry name="Report" data="Public entry"/></menu>
        <window path="report.md" type="text/markdown" edit/>
        <window split="1" type="text/plain" view/>
        <action text="Read build docs" link="https://example.com/build"/>
      </pipeline>
      <pipeline branch="release"><window type="text/plain" data="Release window"/><action text="Release docs" link="https://example.com/release"/></pipeline>
    </project>`)
    const config = await load_config(process.cwd()), diag = new_diagnostics()
    const model = load_site(root, config, diag, new Date("2026-11-23"))
    assert.deepEqual(diag.errors, [])
    const page = model.pages.find(page => page.path === "/projects/example")!, desk = page.node.children[0]
    const windows = desk.children.filter(node => node.tag === "window")
    assert.equal(windows.length, 4)
    assert.equal(windows[2].attrs.split, "2")
    assert(model.resources.has("/srv/projects/example/report.md"))
    const pipelines = model.objects[0].children.filter(node => node.tag === "pipeline")
    assert.equal(pipelines[0].children.filter(node => node.tag === "window")[1].attrs.split, "1")
    assert.equal(parse_pipeline(pipelines[0]).steps.length, 1)
    const html = to_html(render_desk({ model, page, lang: "en", expertise: null }, desk))
    for (const text of ["Build documents", "Public entry", "Pipeline: staging", "Pipeline: release", "Read build docs", "Published report", "Release window"]) assert(html.includes(text), text)
    for (const secret of ["internal-deploy-command", "private-argument", "TOP_SECRET_DEPLOY", "Private policy"]) assert(!html.includes(secret), secret)
})

test("only direct execution steps enter the runtime policy, and unsupported nesting stays invalid", () => {
    const node = parse_xml('<pipeline><menu name="Documents"><entry name="Entry"/></menu><window data="Public"/><action text="Docs" link="/docs"/><step name="Run" command="node"><step name="Log"/></step></pipeline>', "fixture.xml")[0]
    assert.deepEqual(parse_pipeline(node).steps.map(step => step.name), ["Run", "Log"])
    const diag = new_diagnostics()
    validate_roots(parse_xml('<project id="example" name="Example" date="2026"><pipeline><step name="Bad"><window/></step></pipeline></project>', "fixture.xml"), diag)
    assert(diag.errors.some(message => message.includes("not allowed inside <step>")))
    assert.throws(() => parse_pipeline(parse_xml('<pipeline><unexpected/></pipeline>', "fixture.xml")[0]), /pipeline may contain only/)
})
