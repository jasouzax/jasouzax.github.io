/** Browser position recovery tolerates corrupt and hostile-shaped local records. */
import { test } from "node:test"
import assert from "node:assert/strict"
import { read_positions, save_positions } from "../../../../desk/menu/map/positions.ts"

test("position records reject malformed coordinates and tolerate storage failures", () => {
    let value = '{"valid":{"x":0,"y":-20},"bad":{"x":"3","y":0},"nil":null}'
    const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage")
    try {
        Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => value, setItem: (_key: string, next: string) => { value = next } } })
        assert.deepEqual(read_positions("map"), { valid: { x: 0, y: -20 } })
        value = "broken"; assert.deepEqual(read_positions("map"), {})
        save_positions("map", { saved: { x: 5, y: 6 } })
        assert.deepEqual(read_positions("map"), { saved: { x: 5, y: 6 } })
        Object.defineProperty(globalThis, "localStorage", { configurable: true, get: () => { throw new Error("denied") } })
        assert.deepEqual(read_positions("map"), {})
        assert.doesNotThrow(() => save_positions("map", {}))
    } finally {
        if (previous) Object.defineProperty(globalThis, "localStorage", previous)
        else Reflect.deleteProperty(globalThis, "localStorage")
    }
})
