import { test } from "node:test"
import assert from "node:assert/strict"
import { preview_key } from "../src/web/client/desk_previews.ts"
import { memory_directory } from "../src/web/client/memory_fs.ts"

test("preview keys reuse unchanged files and change with content, paths, types and timestamps", async () => {
    const file = new File(["const value = 1"], "test.js", { lastModified: 100 })
    const key = await preview_key("/home/user/test.js", file, "text/javascript")
    assert.match(key, /^[a-f0-9]{64}$/)
    assert.equal(await preview_key("/home/user/test.js", file, "text/javascript"), key)
    assert.notEqual(await preview_key("/home/user/renamed.js", file, "text/javascript"), key)
    assert.notEqual(await preview_key("/home/user/test.js", file, "text/plain"), key)
    assert.notEqual(await preview_key("/home/user/test.js", new File(["const value = 1"], "test.js", { lastModified: 101 }), "text/javascript"), key)
    assert.notEqual(await preview_key("/home/user/test.js", new File(["const value = 2"], "test.js", { lastModified: 100 }), "text/javascript"), key)
})

test("memory file timestamps stay stable between reads and advance even for same-size edits", async () => {
    const dir = memory_directory("tmp")
    const file = await dir.getFileHandle("test.txt", { create: true })
    const writer = await file.createWritable!()
    await writer.write("one"); await writer.close()
    const before = await file.getFile()
    assert.equal((await file.getFile()).lastModified, before.lastModified)
    const next = await file.createWritable!()
    await next.write("two"); await next.close()
    assert.ok((await file.getFile()).lastModified > before.lastModified)
})
