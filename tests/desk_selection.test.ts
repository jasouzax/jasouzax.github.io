import { test } from "node:test"
import assert from "node:assert/strict"
import { selection_click, type file_selection } from "../src/web/client/desk_selection.ts"

test("Ctrl toggles entries and Shift replaces only the current anchored range", () => {
    const visible = ["a", "b", "c", "d", "e", "f", "g", "h"]
    let state: file_selection = { selection: new Set(), anchor: null, range_base: null }
    const click = (path: string, ctrl = false, shift = false) => { state = selection_click(state, visible, path, ctrl, shift) }
    const selected = () => [...state.selection].sort()
    click("a")
    click("h", true)
    click("c", true)
    click("e", false, true)
    assert.deepEqual(selected(), ["a", "c", "d", "e", "h"])
    click("g", false, true)
    assert.deepEqual(selected(), ["a", "c", "d", "e", "f", "g", "h"])
    click("d", false, true)
    assert.deepEqual(selected(), ["a", "c", "d", "h"])
    click("b", true)
    click("f", false, true)
    assert.deepEqual(selected(), ["a", "b", "c", "d", "e", "f", "h"])
    click("c", false, true)
    assert.deepEqual(selected(), ["a", "b", "c", "d", "h"])
    click("h", true)
    assert.deepEqual(selected(), ["a", "b", "c", "d"])
    click("a")
    assert.deepEqual(selected(), ["a"])
    click("a", true)
    assert.deepEqual(selected(), [])
})

test("Shift supports reverse ranges and a missing anchor without selecting collapsed descendants", () => {
    const state: file_selection = { selection: new Set(["a", "e"]), anchor: "e", range_base: null }
    const reversed = selection_click(state, ["a", "b", "e"], "b", false, true)
    assert.deepEqual([...reversed.selection].sort(), ["a", "b", "e"])
    assert.equal(reversed.selection.has("collapsed-child"), false)
    const missing = selection_click({ ...state, anchor: "collapsed-child" }, ["a", "b", "e"], "b", false, true)
    assert.deepEqual([...missing.selection], ["b"])
    assert.equal(missing.anchor, "b")
})
