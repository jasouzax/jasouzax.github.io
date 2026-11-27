import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync, utimesSync, renameSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execFileSync } from "node:child_process"
import { Source_Manifest } from "../../../engine/load/manifest.ts"

function fixture(t: { after(fn: () => void): void }) {
    const root = mkdtempSync(join(tmpdir(), "jazu-manifest-"))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    mkdirSync(join(root, "content"))
    return { root, file: join(root, "content/page.xml") }
}

test("source manifests reuse detached trees, restore parent pointers and preserve attributes named file/parent", t => {
    const { root, file } = fixture(t)
    writeFileSync(file, '<page file="authored" parent="keep"><hero name="Original"/></page>')
    const first = new Source_Manifest(root), tree = first.xml(file)
    tree[0].children[0].attrs.name = "Mutated by generator"; first.save()
    const next = new Source_Manifest(root), restored = next.xml(file)
    assert.deepEqual(next.stats, { parsed: 0, reused: 1, hashed: 0, hash_reused: 0 })
    assert.equal(restored[0].children[0].attrs.name, "Original")
    assert.equal(restored[0].children[0].parent, restored[0])
    assert.equal(restored[0].attrs.file, "authored"); assert.equal(restored[0].attrs.parent, "keep")
    assert.equal(restored[0].file, file)
    const forced = new Source_Manifest(root, true); forced.xml(file)
    assert.equal(forced.stats.parsed, 1)
})

test("same-length edits with restored modification times invalidate parsing and source digests", t => {
    const { root, file } = fixture(t)
    writeFileSync(file, '<page name="Before"/>')
    const previous = statSync(file), first = new Source_Manifest(root)
    first.xml(file); const hash = first.tree(join(root, "content")); first.save()
    const unchanged = new Source_Manifest(root); unchanged.xml(file)
    assert.equal(unchanged.tree(join(root, "content")), hash); assert.equal(unchanged.stats.hash_reused, 1)
    writeFileSync(file, '<page name="After!"/>'); utimesSync(file, previous.atime, previous.mtime)
    const edited = new Source_Manifest(root)
    assert.equal(edited.xml(file)[0].attrs.name, "After!"); assert.equal(edited.stats.parsed, 1)
    assert.notEqual(edited.tree(join(root, "content")), hash)
    renameSync(file, join(root, "content/renamed.xml")); edited.save()
    assert(!JSON.parse(readFileSync(join(root, ".cache/sources.json"), "utf8")).files["content/page.xml"])
    assert.notEqual(edited.tree(join(root, "content")), hash)
})

test("Git revision differences invalidate matching cached metadata", t => {
    const { root, file } = fixture(t)
    const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { stdio: "pipe", windowsHide: true })
    git("init", "-b", "staging"); git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.test")
    writeFileSync(file, '<page name="Before"/>'); git("add", "content"); git("commit", "-m", "test: seed authored content")
    const first = new Source_Manifest(root); first.xml(file); first.save()
    writeFileSync(file, '<page name="After!"/>'); git("add", "content"); git("commit", "-m", "test: revise authored content")
    // Model a restored tree with otherwise identical metadata to isolate the HEAD invalidation path.
    const path = join(root, ".cache/sources.json"), cache = JSON.parse(readFileSync(path, "utf8")), info = statSync(file, { bigint: true })
    cache.files["content/page.xml"].stamp = [info.size, info.mtimeNs, info.ctimeNs, info.ino, info.mode].join(":")
    writeFileSync(path, JSON.stringify(cache))
    const next = new Source_Manifest(root)
    assert.equal(next.xml(file)[0].attrs.name, "After!"); assert.equal(next.stats.parsed, 1)
})

test("corrupt manifests and malformed cached trees fall back to strict XML parsing", t => {
    const { root, file } = fixture(t)
    writeFileSync(file, '<page name="Valid"/>')
    const first = new Source_Manifest(root); first.xml(file); first.save()
    const path = join(root, ".cache/sources.json"), cache = JSON.parse(readFileSync(path, "utf8"))
    cache.files["content/page.xml"].tree = '[{"tag":12}]'; writeFileSync(path, JSON.stringify(cache))
    const repaired = new Source_Manifest(root); assert.equal(repaired.xml(file)[0].attrs.name, "Valid"); assert.equal(repaired.stats.parsed, 1)
    writeFileSync(path, "corrupt")
    assert.equal(new Source_Manifest(root).xml(file)[0].attrs.name, "Valid")
    writeFileSync(file, "<page>")
    assert.throws(() => new Source_Manifest(root).xml(file))
})
