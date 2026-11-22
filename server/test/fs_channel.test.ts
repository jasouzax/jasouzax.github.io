import { test } from "node:test"
import assert from "node:assert/strict"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { Fs_Error, confine, handle_fs, read_text } from "../terminal/fs_channel.ts"
import { from_base64, to_base64 } from "../../shared/protocol/codec.ts"

async function sandbox(): Promise<string> {
    return fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "jazu-fs-")))
}
const code_of = async (promise: Promise<unknown>) => promise.then(() => "ok", (error: Fs_Error) => error.code)
const text = (value: string) => to_base64(new TextEncoder().encode(value))

test("write in chunks, read back, stat and list", async () => {
    const root = await sandbox()
    const file = `${root}/a.txt`
    await handle_fs(root, { op: "write", path: file, offset: 0, data: text("hello "), truncate: true })
    const written = await handle_fs(root, { op: "write", path: file, offset: 6, data: text("world") })
    assert.deepEqual(written, { op: "write", size: 11 })
    const read = await handle_fs(root, { op: "read", path: file, offset: 0, length: 1000 })
    assert.equal(read.op === "read" && new TextDecoder().decode(from_base64(read.data)), "hello world")
    assert.ok(read.op === "read" && read.eof && read.size === 11)
    const part = await handle_fs(root, { op: "read", path: file, offset: 6, length: 2 })
    assert.ok(part.op === "read" && !part.eof && new TextDecoder().decode(from_base64(part.data)) === "wo")
    const stat = await handle_fs(root, { op: "stat", path: file })
    assert.ok(stat.op === "stat" && stat.stat.kind === "file" && stat.stat.size === 11 && stat.stat.writable)
    await handle_fs(root, { op: "mkdir", path: `${root}/sub` })
    const listing = await handle_fs(root, { op: "list", path: root })
    assert.deepEqual(listing.op === "list" && listing.entries.map(entry => [entry.name, entry.kind]), [["a.txt", "file"], ["sub", "dir"]])
})

test("rename, copy and remove", async () => {
    const root = await sandbox()
    await handle_fs(root, { op: "mkdir", path: `${root}/d` })
    await handle_fs(root, { op: "write", path: `${root}/d/x`, offset: 0, data: text("x"), truncate: true })
    await handle_fs(root, { op: "copy", path: `${root}/d`, to: `${root}/e` })
    await handle_fs(root, { op: "rename", path: `${root}/d`, to: `${root}/f` })
    assert.equal(await code_of(handle_fs(root, { op: "stat", path: `${root}/d` })), "ENOENT")
    assert.equal(await code_of(handle_fs(root, { op: "remove", path: `${root}/f` })), "ENOTEMPTY")
    await handle_fs(root, { op: "remove", path: `${root}/f`, recursive: true })
    assert.equal(await code_of(handle_fs(root, { op: "copy", path: `${root}/e`, to: `${root}/e` })), "EINVAL")
    assert.equal(await code_of(handle_fs(root, { op: "mkdir", path: `${root}/e` })), "EEXIST")
})

test("errors carry errno-like codes", async () => {
    const root = await sandbox()
    assert.equal(await code_of(handle_fs(root, { op: "stat", path: `${root}/none` })), "ENOENT")
    assert.equal(await code_of(handle_fs(root, { op: "read", path: root, offset: 0, length: 1 })), "EISDIR")
    assert.equal(await code_of(handle_fs(root, { op: "list", path: `${root}/none` })), "ENOENT")
    await handle_fs(root, { op: "write", path: `${root}/f`, offset: 0, data: "", truncate: true })
    assert.equal(await code_of(handle_fs(root, { op: "list", path: `${root}/f` })), "ENOTDIR")
    assert.equal(await code_of(handle_fs(root, { op: "write", path: `${root}/f`, offset: 0, data: "!!!" })), "EINVAL")
    assert.equal(await code_of(handle_fs(root, { op: "write", path: `${root}/f`, offset: 0, data: "A".repeat(600_000) })), "EFBIG")
})

test("paths must be absolute and stay inside the root, also through .. and symlinks", async () => {
    const root = await sandbox()
    const outside = await sandbox()
    await fs.writeFile(`${outside}/secret`, "s")
    await fs.symlink(outside, `${root}/link`)
    for (const bad of ["relative", "", `${root}/../x`, `${root}/a/../../etc`, `${outside}/secret`]) assert.equal(await code_of(confine(root, bad)), bad === "relative" || bad === "" ? "EINVAL" : "EACCES", bad)
    assert.equal(await code_of(handle_fs(root, { op: "read", path: `${root}/link/secret`, offset: 0, length: 10 })), "EACCES")
    assert.equal(await code_of(handle_fs(root, { op: "write", path: `${root}/link/new`, offset: 0, data: "", truncate: true })), "EACCES")
    assert.equal(await confine(root, `${root}/new/deep/file`), `${root}/new/deep/file`)
    assert.equal(await confine("/", "/etc//hosts/"), "/etc/hosts")
    assert.equal(await code_of(confine(root, 5 as unknown as string)), "EINVAL")
})

test("read_text reads small plain files inside the root only", async () => {
    const root = await sandbox()
    await fs.writeFile(path.join(root, "a.auto.js"), "console.log(1)")
    await fs.mkdir(path.join(root, "dir"))
    assert.equal(await read_text(root, path.join(root, "a.auto.js")), "console.log(1)")
    assert.equal(await code_of(read_text(root, path.join(root, "dir"))), "EISDIR")
    assert.equal(await code_of(read_text(root, path.join(root, "a.auto.js"), 3)), "EFBIG")
    assert.equal(await code_of(read_text(root, "/etc/hostname")), "EACCES")
    assert.equal(await code_of(read_text(root, "relative.js")), "EINVAL")
})
