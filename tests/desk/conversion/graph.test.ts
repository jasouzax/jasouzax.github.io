import { test } from "node:test"
import assert from "node:assert/strict"
import { route, execute, type Converter } from "../../../desk/conversion/graph.ts"
const edge = (from: string, to: string): Converter => ({ id: `${from}-${to}`, from, to, extension: "out", run: async file => new Blob([await file.text(), to], { type: to }) })
test("routes prefer direct edges, chain through intermediates and terminate cycles", async () => {
    const ab = edge("a/a", "b/b"), bc = edge("b/b", "c/c"), ca = edge("c/c", "a/a"), ac = edge("a/a", "c/c")
    assert.deepEqual(route([ab, bc, ca], "A/A; charset=utf8", "c/c"), [ab, bc])
    assert.deepEqual(route([ab, bc, ca, ac], "a/a", "c/c"), [ac])
    assert.equal(route([ab, bc, ca], "a/a", "d/d"), null)
    assert.equal(await (await execute([ab, bc], new Blob(["start"]), {}, new AbortController().signal)).text(), "startb/bc/c")
})
test("execution reports the failed step and stops aborted work", async () => {
    const bad = { ...edge("a/a", "b/b"), run: async () => { throw new Error("bad data") } }
    await assert.rejects(execute([bad], new Blob(), {}, new AbortController().signal), /a\/a-b\/b.*bad data/)
    const abort = new AbortController(); abort.abort()
    await assert.rejects(execute([bad], new Blob(), {}, abort.signal), /abort/i)
})
