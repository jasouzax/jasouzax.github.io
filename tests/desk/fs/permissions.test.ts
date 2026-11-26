import { test } from "node:test"
import assert from "node:assert/strict"
import type { fs_node } from "../../../desk/fs/opfs.ts"
import { check_directory_target, recursive_target, can_read, can_create, can_move, check_permissions } from "../../../desk/fs/permissions.ts"

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

test("peer aliases cannot copy directories into themselves or re-export the network", () => {
    const handle = { kind: "directory", name: "shared" }
    const root = { path: "/", kind: "dir", parent: null, handle: {} } as unknown as fs_node
    const source = { path: "/net/peer/shared", kind: "dir", parent: root, handle: { native_handle: handle } } as unknown as fs_node
    const parent = { path: "/shared", kind: "dir", parent: root, handle } as unknown as fs_node
    const target = { path: "/shared/child", kind: "dir", parent, handle: {} } as unknown as fs_node
    assert.equal(recursive_target(source, target), true)
    assert.equal(recursive_target({ ...source, path: "/net" }, root), true)
    assert.equal(recursive_target(source, root), false)
})

test("native containment checks reject persistent compute roots nested in the source storage", async () => {
    const target_handle = { resolve: async () => null }
    const source = folder(null, true), target = folder(null, true)
    source.path = "/home/user"; source.handle = { resolve: async (other: unknown) => other === target_handle ? [".computes", "id"] : null }
    target.handle = { native_handle: target_handle }
    await assert.rejects(check_directory_target(source, target), /inside itself/)
    target.handle = { getDirectoryHandle: async () => {} }
    await check_directory_target(source, target)
})

test("permission results from a replaced folder cannot disable its new mount", async () => {
    let finish!: (value: string) => void
    const pending = new Promise<string>(resolve => { finish = resolve })
    const node = folder(null, true)
    node.handle = { queryPermission: () => pending }
    const checking = check_permissions([node])
    node.handle = {}; node.readable = true; node.write_allowed = true
    finish("denied")
    await checking
    assert.equal(node.readable, true)
    assert.equal(node.write_allowed, true)
})
