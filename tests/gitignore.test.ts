import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { test } from "node:test"
import { collect_unignored, is_ignored, parse_ignore } from "../src/gitignore.ts"

function tree(files: Record<string, string>): { root: string, listed: () => string[] } {
    const root = mkdtempSync(join(tmpdir(), "jazu_ignore_"))
    for (const [name, text] of Object.entries(files)) {
        mkdirSync(join(root, name, ".."), { recursive: true })
        writeFileSync(join(root, name), text)
    }
    return { root, listed: () => collect_unignored(root).map(path => relative(root, path).split("\\").join("/")).sort() }
}

test("ignores by extension at any depth, even without git", () => {
    const { root, listed } = tree({ ".gitignore": "*.wasm\n*.tar.gz\n*.tar.bz2\n", "a.txt": "", "x/y.wasm": "", "x/z.tar.gz": "", "x/w.tar.bz2": "", "x/keep.ts": "" })
    assert.deepEqual(listed(), [".gitignore", "a.txt", "x/keep.ts"])
    rmSync(root, { recursive: true })
})

test("nested .gitignore applies to its directory only and tolerates CRLF", () => {
    const { root, listed } = tree({ "content/.gitignore": "/media/\r\n", "content/media/v.mp4": "", "content/a.xml": "", "other/media/v.mp4": "" })
    assert.deepEqual(listed(), ["content/.gitignore", "content/a.xml", "other/media/v.mp4"])
    rmSync(root, { recursive: true })
})

test("negation, directory-only, anchoring and double-star rules", () => {
    const rules = parse_ignore("*.log\n!keep.log\nbuild/\n/root_only.txt\ndocs/**/tmp\n**/cache\nsecret/*\n", "")
    assert.equal(is_ignored("a/b.log", false, rules), true)
    assert.equal(is_ignored("a/keep.log", false, rules), false)
    assert.equal(is_ignored("build", true, rules), true)
    assert.equal(is_ignored("build", false, rules), false)
    assert.equal(is_ignored("root_only.txt", false, rules), true)
    assert.equal(is_ignored("sub/root_only.txt", false, rules), false)
    assert.equal(is_ignored("docs/a/b/tmp", true, rules), true)
    assert.equal(is_ignored("docs/tmp", true, rules), true)
    assert.equal(is_ignored("x/y/cache", true, rules), true)
    assert.equal(is_ignored("secret/k", false, rules), true)
})

test("always skips .git and node_modules, and cannot re-include inside ignored directories", () => {
    const { root, listed } = tree({ ".gitignore": "out/\n!out/keep.txt\n", ".git/config": "", "node_modules/p/i.js": "", "out/keep.txt": "", "src/a.ts": "" })
    assert.deepEqual(listed(), [".gitignore", "src/a.ts"])
    rmSync(root, { recursive: true })
})
