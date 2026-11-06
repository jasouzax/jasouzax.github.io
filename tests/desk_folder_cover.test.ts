import { test } from "node:test"
import assert from "node:assert/strict"
import { folder_cover_plan, folder_change } from "../src/web/client/desk_folder_cover.ts"

test("folder covers use direct files only and mark immediate subfolders separately", () => {
    const nested = { kind: "dir" as const, name: "nested", children: [{ kind: "file", name: "hidden.png" }] }
    const files = Array.from({ length: 6 }, (_, index) => ({ kind: "file" as const, name: `${index}.png` }))
    const plan = folder_cover_plan([nested, ...files])
    assert.deepEqual(plan.files.map(file => file.name), ["0.png", "1.png", "2.png", "3.png"])
    assert.equal(plan.count, 6)
    assert.equal(plan.nested, true)
    assert.deepEqual(folder_cover_plan([nested]), { files: [], nested: true, count: 0 })
    assert.deepEqual(folder_cover_plan([]), { files: [], nested: false, count: 0 })
})

test("direct folder changes refresh covers without propagating deeper changes to ancestors", () => {
    const root = "/home/user/pictures"
    assert.equal(folder_change(root, root), "contents")
    assert.equal(folder_change(root, "/home/user"), "contents")
    assert.equal(folder_change(root, `${root}/album`), "cover")
    assert.equal(folder_change(root, `${root}/album/nested`), null)
    assert.equal(folder_change(root, "/home/user/pictures2/album"), null)
    assert.equal(folder_change("/", "/home"), "cover")
})
