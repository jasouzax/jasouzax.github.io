import { test } from "node:test"
import assert from "node:assert/strict"
import { flow_of, no_picks } from "../src/web/client/desk_flow_rules.ts"
import { adopt, announce_edit, children_of, flow_kind_of, document_of, is_dirty, accept_save, forget_edits, latest_bytes, link_hooks, refresh_children, release_links, subscribe_edits } from "../src/web/client/desk_flow.ts"
import type { desk_window } from "../src/web/client/desk.ts"
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

const fake_window = (): desk_window => ({ parent: null, picks: no_picks() }) as unknown as desk_window

test("a child's flow follows what the user picked in it", () => {
    assert.equal(flow_of(no_picks()), "")
    assert.equal(flow_of({ ...no_picks(), mode: true }), "mirror")
    assert.equal(flow_of({ ...no_picks(), mime: true }), "convert")
    assert.equal(flow_of({ ...no_picks(), mime: true, mode: true }), "convert")
    assert.equal(flow_of({ ...no_picks(), own: true }), "compare")
    assert.equal(flow_of({ mime: true, mode: true, own: true }), "compare")
})

test("links: a child is its parent's child until either closes", () => {
    const parent = fake_window()
    const child = fake_window()
    const other = fake_window()
    adopt(parent, child)
    assert.deepEqual(children_of(parent), [child])
    assert.equal(child.parent, parent)
    assert.equal(flow_kind_of(child), "")
    child.picks.mode = true
    assert.equal(flow_kind_of(child), "mirror")
    assert.equal(flow_kind_of(parent), "")
    assert.equal(flow_kind_of(other), "")
    const drawn: desk_window[] = []
    link_hooks.render = item => { drawn.push(item) }
    refresh_children(parent)
    assert.deepEqual(drawn, [])
    parent.file = new Blob(["new resource"])
    refresh_children(parent)
    assert.deepEqual(drawn, [child])
    // the parent closes: the child is an ordinary window again, drawn once
    drawn.length = 0
    release_links(parent, true)
    assert.equal(child.parent, null)
    assert.deepEqual(children_of(parent), [])
    assert.deepEqual(drawn, [child])
    assert.equal(flow_kind_of(child), "")
})

test("links: a closing child leaves its parent, and a discarded desk redraws nothing", () => {
    const parent = fake_window()
    const first = fake_window()
    const second = fake_window()
    adopt(parent, first)
    adopt(parent, second)
    release_links(first, true)
    assert.deepEqual(children_of(parent), [second])
    const drawn: desk_window[] = []
    link_hooks.render = item => { drawn.push(item) }
    release_links(parent, false)
    assert.deepEqual(drawn, [])
    assert.equal(second.parent, null)
})

test("edits reach subscribers and the newest bytes are kept until forgotten", () => {
    const source = fake_window()
    const seen: number[][] = []
    const stop = subscribe_edits(source, bytes => { seen.push([...bytes]) })
    assert.equal(latest_bytes(source), null)
    announce_edit(source, new Uint8Array([1, 2]))
    announce_edit(source, new Uint8Array([3]))
    assert.deepEqual(seen, [[1, 2], [3]])
    assert.deepEqual([...latest_bytes(source)!], [3])
    stop()
    announce_edit(source, new Uint8Array([4]))
    assert.equal(seen.length, 2)
    forget_edits(source)
    assert.equal(latest_bytes(source), null)
})


test("mirrors share current edits both ways; comparisons keep independent bytes", () => {
    const parent = fake_window(), mirror = fake_window(), sibling = fake_window(), compare = fake_window()
    for (const child of [mirror, sibling, compare]) adopt(parent, child)
    mirror.picks.mode = sibling.picks.mode = true
    compare.picks.own = true
    const seen: number[][] = []
    const stop = subscribe_edits(parent, bytes => seen.push([...bytes]))
    announce_edit(mirror, new Uint8Array([10]))
    assert.equal(document_of(mirror), parent)
    assert.deepEqual([...latest_bytes(sibling)!], [10])
    assert.equal(latest_bytes(compare), null)
    const pending = latest_bytes(parent)
    announce_edit(sibling, new Uint8Array([20]))
    accept_save(parent, new Blob(["old save"]), pending)
    assert.equal(is_dirty(parent), true, "a slow save must not clear newer edits")
    accept_save(parent, new Blob(["new save"]), latest_bytes(parent))
    assert.equal(is_dirty(mirror), false)
    announce_edit(compare, new Uint8Array([30]))
    assert.deepEqual([...latest_bytes(parent)!], [20])
    release_links(parent, false)
    assert.deepEqual([...latest_bytes(mirror)!], [20], "orphan retains the shared document")
    stop()
    assert.deepEqual(seen.slice(0, 2), [[10], [20]])
})


test("closing a middle mirror retains its current draft in nested children", () => {
    const root = fake_window(), middle = fake_window(), leaf = fake_window()
    adopt(root, middle); middle.picks.mode = true
    adopt(middle, leaf); leaf.picks.mode = true
    announce_edit(root, new Uint8Array([42]))
    release_links(middle, false)
    assert.equal(leaf.parent, null)
    assert.deepEqual([...latest_bytes(leaf)!], [42])
    assert.equal(is_dirty(leaf), true)
    announce_edit(root, new Uint8Array([43]))
    assert.deepEqual([...latest_bytes(leaf)!], [42])
})
