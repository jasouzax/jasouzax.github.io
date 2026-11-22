import test from "node:test"
import assert from "node:assert/strict"
import { remote_directory, dom_error, join_path, max_read_bytes, type Fs_Client } from "../src/web/client/server_fs.ts"
import { handle_fs, Fs_Error } from "../server/src/fs_channel.ts"
import { Fs_Error as Link_Error } from "../src/web/client/server_link.ts"
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Fs_Request, Fs_Result } from "../shared/protocol/wire.ts"

// The real agent channel on a real temp directory stands in for the Pi: the page's handles run against it unchanged
function against(root: string): Fs_Client & { calls: Fs_Request[] } {
    const calls: Fs_Request[] = []
    return {
        calls,
        async fs(request: Fs_Request): Promise<Fs_Result> {
            calls.push(request)
            try { return await handle_fs(root, request) } catch (error) {
                if (error instanceof Fs_Error) throw new Link_Error(error.code, error.message)
                throw error
            }
        },
    }
}

function fixture() {
    const root = mkdtempSync(join(tmpdir(), "srvfs-"))
    writeFileSync(join(root, "a.txt"), "hello")
    mkdirSync(join(root, "sub"))
    writeFileSync(join(root, "sub", "b.bin"), Buffer.from([0, 1, 2, 255]))
    return { root, client: against(root) }
}

test("lists directories first-class and files with names; reads text and binary exactly", async () => {
    const { root: base, client } = fixture()
    const root = remote_directory(client, base)
    const names: string[] = []
    for await (const entry of root.values()) names.push(`${entry.kind}:${entry.name}`)
    assert.deepEqual(names.sort(), ["directory:sub", "file:a.txt"])
    const text = await (await root.getFileHandle("a.txt")).getFile()
    assert.equal(await text.text(), "hello")
    const sub = await root.getDirectoryHandle("sub")
    const bin = await (await sub.getFileHandle("b.bin")).getFile()
    assert.deepEqual([...new Uint8Array(await bin.arrayBuffer())], [0, 1, 2, 255])
    assert.ok(text.lastModified > 0)
})

test("writes replace a file, create new ones and cross the chunk size", async () => {
    const { root, client } = fixture()
    const dir = remote_directory(client, root)
    const handle = await dir.getFileHandle("new.txt", { create: true })
    assert.equal(readFileSync(join(root, "new.txt"), "utf8"), "")
    const writer = await handle.createWritable!()
    await writer.write("one ")
    await writer.write(new Blob(["two"]))
    await writer.close()
    assert.equal(readFileSync(join(root, "new.txt"), "utf8"), "one two")
    const big = Buffer.alloc(900 * 1024, 7)
    const again = await (await dir.getFileHandle("big.bin", { create: true })).createWritable!()
    await again.write(new Blob([big]))
    await again.close()
    assert.deepEqual(readFileSync(join(root, "big.bin")), big)
    assert.deepEqual(readFileSync(join(root, "big.bin")).length, 900 * 1024)
    const empty = await (await dir.getFileHandle("a.txt")).createWritable!()
    await empty.close()
    assert.equal(readFileSync(join(root, "a.txt"), "utf8"), "")
})

test("folders: create, remove (recursive only when asked), rename through move()", async () => {
    const { root, client } = fixture()
    const dir = remote_directory(client, root)
    await dir.getDirectoryHandle("made", { create: true })
    assert.ok(existsSync(join(root, "made")))
    await assert.rejects(dir.removeEntry("sub"), (error: DOMException) => error.name === "InvalidModificationError")
    await dir.removeEntry("sub", { recursive: true })
    assert.ok(!existsSync(join(root, "sub")))
    const file = await dir.getFileHandle("a.txt")
    await file.move!("renamed.txt")
    assert.ok(existsSync(join(root, "renamed.txt")) && !existsSync(join(root, "a.txt")))
})

test("errors become the DOMException names the desk handles", async () => {
    const { root, client } = fixture()
    const dir = remote_directory(client, root)
    await assert.rejects(dir.getFileHandle("missing"), (error: DOMException) => error.name === "NotFoundError")
    await assert.rejects(dir.getFileHandle("sub"), (error: DOMException) => error.name === "TypeMismatchError")
    await assert.rejects(dir.getDirectoryHandle("a.txt"), (error: DOMException) => error.name === "TypeMismatchError")
    await assert.rejects(dir.getFileHandle("../x", { create: true }), (error: DOMException) => error.name === "TypeError")
    await assert.rejects(dir.getFileHandle("a/b", { create: true }), (error: DOMException) => error.name === "TypeError")
    assert.equal(dom_error(new Link_Error("OFFLINE", "x")).name, "NetworkError")
    assert.equal(dom_error(new Link_Error("TIMEOUT", "x")).name, "TimeoutError")
    assert.equal(dom_error(new Link_Error("EACCES", "x")).name, "NotAllowedError")
    assert.equal(dom_error(new Error("weird")).name, "UnknownError")
    symlinkSync("/nonexistent-target", join(root, "dangling"))
})

test("a file over the read limit is refused before any data is read; join_path guards names", async () => {
    const calls: Fs_Request[] = []
    const client: Fs_Client = { async fs(request) { calls.push(request); return { op: "stat", stat: { kind: "file", size: max_read_bytes + 1, mtime: 1, mode: 0o644, writable: true } } } }
    const file = await remote_directory(client).getFileHandle("huge")
    await assert.rejects(file.getFile(), (error: DOMException) => error.name === "NotReadableError")
    assert.deepEqual(calls.map(call => call.op), ["stat", "stat"])
    assert.equal(join_path("/", "x"), "/x")
    assert.equal(join_path("/a/b", "x"), "/a/b/x")
    assert.throws(() => join_path("/", ".."), (error: DOMException) => error.name === "TypeError")
})
