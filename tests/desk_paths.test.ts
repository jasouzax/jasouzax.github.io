import { test } from "node:test"
import assert from "node:assert/strict"
import { local_file_path } from "../src/web/client/desk_paths.ts"

test("virtual file URIs accept both home spellings and normalize absolute paths", () => {
    for (const uri of ["file:///home/user", "file://home/user", "FILE://home/user/", " file://localhost/home/user ", "/home/./user/"]) {
        assert.equal(local_file_path(uri), "/home/user")
    }
    assert.equal(local_file_path("file:///home/user/../user/a.txt"), "/home/user/a.txt")
    assert.equal(local_file_path("file:///../../"), "/")
    assert.equal(local_file_path("file://home/user/a%20b.txt"), "/home/user/a%20b.txt")
    for (const uri of ["pid:", "https://example.com/file", "relative.txt", "file:/home/user"]) assert.equal(local_file_path(uri), null)
})
