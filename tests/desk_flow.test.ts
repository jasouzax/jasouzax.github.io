import { test } from "node:test"
import assert from "node:assert/strict"
import { case_flow, is_child_case, plugin_serves_flow, select_case, select_flow_case, type plugin_case, type plugin_target } from "../src/plugin_types.ts"

const file = new Blob(["x"])
const target = (mime: string, mode: string, path = "", has_file = true): plugin_target => ({ mime, mode, path, file: has_file ? file : null })

test("a case's flow is read from its child_* attributes", () => {
    assert.equal(case_flow({ mime: "image/png", host: "media" }), "")
    assert.equal(case_flow({ mime: "image/png", child_mime: "image/jpeg", host: "media" }), "convert")
    assert.equal(case_flow({ child_file: "true", child_mime: "image/*", host: "media" }), "compare")
    assert.equal(case_flow({ child_url: "https://*", host: "text" }), "compare")
    assert.equal(case_flow({ child_view: "true", host: "markdown" }), "mirror")
    assert.equal(case_flow({ child_edit: "true", child_view: "false", host: "text" }), "mirror")
    assert.equal(is_child_case({ mime: "text/*" }), false)
    assert.equal(is_child_case({ child_edit: "false" }), true)
})

test("ordinary window matching ignores flow cases", () => {
    const cases: plugin_case[] = [
        { file: "true", mime: "image/png", child_mime: "image/jpeg", host: "media" },
        { file: "true", view: "true", mime: "image/*", host: "media" },
    ]
    assert.equal(select_case(cases, target("image/png", "view")), cases[1])
    assert.equal(select_case([cases[0]], target("image/png", "view")), null)
})

test("convert: the parent's mime and the picked child mime choose the case", () => {
    const cases: plugin_case[] = [
        { file: "true", mime: "image/png", child_mime: "image/jpeg", host: "media" },
        { file: "true", mime: "image/*", child_mime: "image/webp", host: "media" },
    ]
    const parent = target("image/png", "view")
    assert.equal(select_flow_case(cases, "convert", parent, target("image/jpeg", "view", "", false)), cases[0])
    assert.equal(select_flow_case(cases, "convert", parent, target("image/webp", "view", "", false)), cases[1])
    assert.equal(select_flow_case(cases, "convert", parent, target("image/gif", "view", "", false)), null)
    assert.equal(select_flow_case(cases, "convert", target("text/plain", "view"), target("image/webp", "view", "", false)), null)
    // a compare child is never taken by a convert case
    assert.equal(select_flow_case(cases, "compare", parent, target("image/jpeg", "view", "file:///a.jpg")), null)
})

test("compare: the child's own file and mime are matched with child_*", () => {
    const cases: plugin_case[] = [
        { file: "true", mime: "image/*", child_file: "true", child_mime: "image/*", host: "media" },
        { file: "true", mime: "text/*", child_file: "true", child_mime: "text/*", host: "text" },
    ]
    assert.equal(select_flow_case(cases, "compare", target("text/plain", "edit"), target("text/x-c", "view", "file:///b.c")), cases[1])
    assert.equal(select_flow_case(cases, "compare", target("image/png", "view"), target("image/png", "view", "file:///b.png")), cases[0])
    assert.equal(select_flow_case(cases, "compare", target("image/png", "view"), target("text/plain", "view", "file:///b.txt")), null)
    // the child must hold its own file
    assert.equal(select_flow_case(cases, "compare", target("text/plain", "view"), target("text/plain", "view", "", false)), null)
})

test("mirror: parent mode and child mode choose the case", () => {
    const cases: plugin_case[] = [
        { file: "true", mime: "text/html", child_view: "true", host: "markdown" },
        { file: "true", mime: "text/html", child_edit: "true", host: "text" },
    ]
    const parent = target("text/html", "edit")
    assert.equal(select_flow_case(cases, "mirror", parent, target("text/html", "view", "", false)), cases[0])
    assert.equal(select_flow_case(cases, "mirror", parent, target("text/html", "edit", "", false)), cases[1])
    assert.equal(select_flow_case(cases, "mirror", target("text/plain", "edit"), target("text/plain", "view", "", false)), null)
    // a child with no mode picked has neither mode, so a case that names a mode does not take it
    assert.equal(select_flow_case(cases, "mirror", parent, target("text/html", "", "", false)), null)
})

test("an exact selector reserves the resource in flow cases too", () => {
    const cases: plugin_case[] = [
        { file: "true", mime: "image/png", child_mime: "image/jpeg", child_view: "true", host: "media" },
        { file: "true", mime: "image/*", child_mime: "image/*", host: "media" },
    ]
    // exact png -> jpeg, but the child is in edit mode: the wildcard case must not take it
    assert.equal(select_flow_case(cases, "convert", target("image/png", "view"), target("image/jpeg", "edit", "", false)), null)
    assert.equal(select_flow_case(cases, "convert", target("image/gif", "view"), target("image/jpeg", "edit", "", false)), cases[1])
})

test("a plugin's flow list limits the flows it serves", () => {
    assert.equal(plugin_serves_flow({ id: "a", version: "1" }, "convert"), true)
    assert.equal(plugin_serves_flow({ id: "a", version: "1", flow: "convert, compare" }, "compare"), true)
    assert.equal(plugin_serves_flow({ id: "a", version: "1", flow: "convert" }, "mirror"), false)
})
