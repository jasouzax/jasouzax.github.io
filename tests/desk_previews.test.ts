import { test } from "node:test"
import assert from "node:assert/strict"
import { preview_key, text_excerpt, is_text_preview } from "../src/web/client/desk_previews.ts"
import { memory_directory } from "../src/web/client/memory_fs.ts"

test("text preview excerpts retain at most 39 Unicode characters by 10 lines, without headers", async () => {
    const excerpt = await text_excerpt(new Blob([Array.from({ length: 12 }, (_, i) => `${i}\t${"😀".repeat(60)}`).join("\r\n")]))
    const lines = excerpt!.split("\n")
    assert.equal(lines.length, 10)
    assert.ok(lines.every(line => [...line].length === 39))
    assert.equal(lines[0], `0   ${"😀".repeat(35)}`)
    assert.equal(await text_excerpt(new Blob(["a".repeat(100000), "\nsecond"])), `${"a".repeat(39)}\nsecond`)
    assert.equal(await text_excerpt(new Blob(["one\rtwo\r\nthree\nfour"])), "one\ntwo\nthree\nfour")
    assert.equal(await text_excerpt(new Blob(["bad\0text"])), null)
    assert.equal(await text_excerpt(new Blob([])), "")
    assert.equal(is_text_preview("application/json"), true)
    assert.equal(is_text_preview("image/svg+xml"), false)
})

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
