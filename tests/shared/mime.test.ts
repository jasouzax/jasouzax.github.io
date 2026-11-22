import test from "node:test"
import assert from "node:assert/strict"
import { find_by_name, mime_from_name, mime_info_of, mime_table } from "../../shared/mime.ts"

test("compound extensions pick the automation types, plain ones keep their old type", () => {
    assert.equal(mime_from_name("backup.auto.js"), "application/auto-javascript")
    assert.equal(mime_from_name("Backup.AUTO.JS"), "application/auto-javascript")
    assert.equal(mime_from_name("feed.auto.site"), "application/auto-site")
    assert.equal(mime_from_name("main.js"), "text/javascript")
    assert.equal(mime_from_name("auto.js"), "text/javascript")
    assert.equal(mime_from_name(".auto.js"), "text/javascript")
    assert.equal(mime_from_name("notes.txt"), "text/plain")
    assert.equal(mime_from_name("noextension"), "")
})

test("the automation types are in the table with an icon and a label", () => {
    for (const mime of ["application/auto-javascript", "application/auto-site"]) {
        const info = mime_info_of(mime)
        assert.ok(info, mime)
        assert.ok(info.icon.startsWith("["))
        assert.ok(info.label.length > 0)
    }
})

test("find_by_name works on any list that has extensions and the longest suffix wins", () => {
    const list = [{ id: 1, extensions: ["js"] }, { id: 2, extensions: ["auto.js"] }]
    assert.equal(find_by_name(list, "a.auto.js")?.id, 2)
    assert.equal(find_by_name(list, "a.js")?.id, 1)
    assert.equal(find_by_name(list, "a.ts"), undefined)
    assert.equal(find_by_name(mime_table, "x.mjs")?.mime, "text/javascript")
})
