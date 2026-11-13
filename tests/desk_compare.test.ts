import { test } from "node:test"
import assert from "node:assert/strict"
import { comparison_lines } from "../src/web/client/desk_compare.ts"

test("comparison locates additions and deletions including EOF and empty output", () => {
    const changes = comparison_lines("same\nremoved\nend\n", "same\nadded\nend\n")
    assert.deepEqual([...changes.added], [1])
    assert.deepEqual([...changes.removed], [[1, 1]])
    assert.equal(changes.limited, false)
    assert.deepEqual([...comparison_lines("a\nb", "a").removed], [[0, 2]])
    assert.deepEqual([...comparison_lines("gone\n", "").removed], [[0, 1]])
    assert.equal(comparison_lines("unchanged", "unchanged").added.size, 0)
})

test("unrelated large documents have a bounded comparison budget", () => {
    const source = Array.from({ length: 10000 }, (_, i) => `source${i}`).join("\n")
    const output = Array.from({ length: 10000 }, (_, i) => `output${i}`).join("\n")
    assert.equal(comparison_lines(source, output).limited, true)
})
