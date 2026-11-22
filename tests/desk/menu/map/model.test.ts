/** Layout safety for authored coordinates, nested/cyclic nodes and cursor-centred zoom bounds. */
import { test } from "node:test"
import assert from "node:assert/strict"
import { place_nodes, zoom_at } from "../../../../desk/menu/map/model.ts"

test("map layouts keep positions deterministic and tolerate cycles and invalid coordinates", () => {
    const graph = { nodes: [{ id: "a", name: "A", parent: "b", x: -10, y: 0 }, { id: "b", name: "B", parent: "a", x: NaN }, { id: "c", name: "C" }], edges: [] }
    for (const layout of ["tree", "flow", "graph"]) {
        const nodes = place_nodes(graph, layout)
        assert.deepEqual(nodes, place_nodes(graph, layout))
        assert.equal(nodes[0].x, -10)
        assert.equal(nodes[0].y, 0)
        assert(nodes.every(node => Number.isFinite(node.x) && Number.isFinite(node.y)))
    }
})

test("zoom keeps the pointed graph coordinate fixed and clamps extremes", () => {
    const view = { x: 40, y: -20, scale: .5 }
    const next = zoom_at(view, 2, 200, 100)
    assert.equal((200 - view.x) / view.scale, (200 - next.x) / next.scale)
    assert.equal((100 - view.y) / view.scale, (100 - next.y) / next.scale)
    assert.equal(zoom_at(next, 100, 0, 0).scale, 3)
    assert.equal(zoom_at(next, .001, 0, 0).scale, .2)
})
