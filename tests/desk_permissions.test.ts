import { test } from "node:test"
import assert from "node:assert/strict"
import type { fs_node } from "../src/web/client/desk_fs.ts"
import { can_read, can_create, can_move, check_permissions } from "../src/web/client/desk_fs_permissions.ts"

function folder(parent: fs_node | null, writable = false): fs_node {
    return { name: "folder", path: parent ? `${parent.path}/folder` : "/", kind: "dir", parent, writable, children: [], info: "", handle: null }
}

test("read and write permissions independently control directory creation and selected file changes", async () => {
    const root = folder(null)
    const mount = folder(root, true)
    let read = "granted", write = "denied"
    const queries: string[] = []
    mount.handle = { queryPermission: async ({ mode }: { mode: string }) => { queries.push(mode); return mode === "read" ? read : write } }
    const file: fs_node = { ...folder(mount, true), name: "a.txt", kind: "file", handle: {} }
    await check_permissions([file])
    assert.equal(can_read(file), true)
    assert.equal(can_create(mount), false)
    assert.equal(can_move(file), false)
    assert.deepEqual(queries, ["read", "readwrite"])
    write = "granted"
    await check_permissions([file])
    assert.equal(can_create(mount), true)
    assert.equal(can_move(file), true)
    read = "denied"
    await check_permissions([file])
    assert.equal(can_read(file), false)
    assert.equal(can_create(mount), false)
    assert.equal(can_move(file), false)
    assert.equal(can_read(root), true)
    assert.equal(can_move(root), false)
})

test("permission query failures disable content operations without prompting for access", async () => {
    const node = folder(null, true)
    node.handle = { queryPermission: async () => { throw new Error("revoked") }, requestPermission: () => { throw new Error("must not prompt") } }
    await check_permissions([node])
    assert.equal(can_read(node), false)
    assert.equal(can_create(node), false)
})

test("a file read failure disables reading its content without blocking creation beside it", async () => {
    const dir = folder(null, true)
    dir.handle = {}
    const file: fs_node = { ...folder(dir, true), kind: "file", handle: { getFile: async () => { throw new Error("access denied") } } }
    dir.children = [file]
    await check_permissions([file])
    assert.equal(can_read(file), false)
    assert.equal(can_read(dir), false)
    assert.equal(can_create(dir), true)
})
