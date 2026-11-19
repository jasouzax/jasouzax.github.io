import test from "node:test"
import assert from "node:assert/strict"
import { page_point, modifiers, mouse_button, Click_Counter, wheel_pixels, copy_shortcut, key_events, key_name } from "../src/web/client/server_input.ts"

const plain = { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false }

test("a position in a scaled picture maps onto the page's own pixels", () => {
    const box = { left: 100, top: 50, width: 400, height: 300 }
    assert.deepEqual(page_point(box, { width: 800, height: 600 }, { clientX: 300, clientY: 200 }), { x: 400, y: 300 })
    assert.deepEqual(page_point(box, null, { clientX: 100, clientY: 50 }), { x: 0, y: 0 })
    assert.deepEqual(page_point({ left: 0, top: 0, width: 0, height: 0 }, null, { clientX: 3, clientY: 4 }), { x: 3, y: 4 })
})

test("modifiers, buttons and key names", () => {
    assert.deepEqual(modifiers({ shiftKey: true, ctrlKey: false, altKey: true, metaKey: false }), ["shift", "alt"])
    assert.deepEqual([0, 1, 2].map(mouse_button), ["left", "middle", "right"])
    assert.deepEqual(["ArrowLeft", " ", "Enter"].map(key_name), ["Left", "Space", "Enter"])
})

test("presses close in time and place count up to a triple click, then start over", () => {
    const clicks = new Click_Counter()
    assert.equal(clicks.press(1000, 10, 10), 1)
    assert.equal(clicks.press(1200, 12, 11), 2)
    assert.equal(clicks.press(1350, 12, 11), 3)
    assert.equal(clicks.press(1500, 12, 11), 3)
    assert.equal(clicks.press(2500, 12, 11), 1)
    assert.equal(clicks.press(2600, 200, 200), 1)
})

test("wheel lines and pages become pixels and follow the zoom scale", () => {
    assert.deepEqual(wheel_pixels({ deltaX: 0, deltaY: 3, deltaMode: 1 }, 600, 1), { dx: 0, dy: 120 })
    assert.deepEqual(wheel_pixels({ deltaX: 1, deltaY: 1, deltaMode: 2 }, 600, 0.5), { dx: 300, dy: 300 })
    assert.deepEqual(wheel_pixels({ deltaX: 5, deltaY: 10, deltaMode: 0 }, 600, 2), { dx: 10, dy: 20 })
})

test("copy and cut need Ctrl or Cmd alone", () => {
    assert.equal(copy_shortcut({ ...plain, ctrlKey: true, key: "c" }), "copy")
    assert.equal(copy_shortcut({ ...plain, metaKey: true, key: "X" }), "cut")
    assert.equal(copy_shortcut({ ...plain, ctrlKey: true, shiftKey: true, key: "c" }), null)
    assert.equal(copy_shortcut({ ...plain, key: "c" }), null)
})

test("keys: characters as text, other keys as key events, copy/paste/IME left alone", () => {
    assert.deepEqual(key_events("down", { ...plain, key: "a" }), [{ kind: "text", text: "a" }])
    assert.equal(key_events("up", { ...plain, key: "a" }), "ignore")
    assert.deepEqual(key_events("down", { ...plain, key: "ArrowUp", shiftKey: true }), [{ kind: "key", action: "down", key: "Up", modifiers: ["shift"] }])
    assert.deepEqual(key_events("up", { ...plain, key: "Enter" }), [{ kind: "key", action: "up", key: "Enter", modifiers: [] }])
    assert.deepEqual(key_events("down", { ...plain, ctrlKey: true, key: "a" }), [{ kind: "key", action: "down", key: "a", modifiers: ["ctrl"] }])
    assert.equal(key_events("down", { ...plain, ctrlKey: true, key: "v" }), "ignore")
    assert.equal(key_events("up", { ...plain, ctrlKey: true, key: "v" }), "ignore")
    assert.equal(key_events("down", { ...plain, ctrlKey: true, key: "c" }), "copy")
    assert.equal(key_events("up", { ...plain, ctrlKey: true, key: "c" }), "ignore")
    assert.equal(key_events("down", { ...plain, key: "Process" }), "ignore")
    assert.equal(key_events("down", { ...plain, key: "a", isComposing: true }), "ignore")
})
