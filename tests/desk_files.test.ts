import { test } from "node:test"
import assert from "node:assert/strict"
import { rename_pattern, available_name, zip_blob } from "../src/web/client/desk_files_util.ts"
import { execFileSync } from "node:child_process"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

test("rename counters, literal asterisks and first regex matches expand in selection order", () => {
    const names = ["cat8-17.png", "cat2.png", "cat9.png"]
    const expand = (pattern: string) => names.map((name, index) => rename_pattern(pattern, name, index))
    assert.deepEqual(expand("image_*.jpg"), ["image_0.jpg", "image_1.jpg", "image_2.jpg"])
    assert.deepEqual(expand("image_2*.jpg"), ["image_00.jpg", "image_01.jpg", "image_02.jpg"])
    assert.deepEqual(expand("image_*2.jpg"), ["image_2.jpg", "image_3.jpg", "image_4.jpg"])
    assert.deepEqual(expand("image_3*2.jpg"), ["image_002.jpg", "image_003.jpg", "image_004.jpg"])
    assert.deepEqual(expand("**_<>.jpg"), names.map(name => `*_${name}.jpg`))
    assert.deepEqual(expand("<\\d+>.jpg"), ["8.jpg", "2.jpg", "9.jpg"])
    assert.equal(rename_pattern("<>", "literal_*.png", 2), "literal_*.png")
    assert.equal(rename_pattern("2**_***2", "name", 1), "2*_*3")
    assert.equal(rename_pattern("<missing>.jpg", "name", 0), ".jpg")
    assert.throws(() => rename_pattern("<[>.jpg", "name", 0), SyntaxError)
    assert.throws(() => rename_pattern("100000*.jpg", "name", 0))
    assert.equal(available_name("image.jpg", new Set(["image.jpg", "image (1).jpg", "image (2).jpg"])), "image (3).jpg")
})

test("folder ZIPs extract with an independent ZIP reader, preserving binary data and UTF-8 paths", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jazu-zip-"))
    try {
        const zip = zip_blob([
            { name: "folder/", data: new Uint8Array() },
            { name: "folder/empty/", data: new Uint8Array() },
            { name: "folder/日本語.bin", data: new Uint8Array([0, 255, 128, 65]) },
            { name: "file.txt", data: new TextEncoder().encode("hello\n") },
        ])
        const path = join(dir, "files.zip")
        writeFileSync(path, new Uint8Array(await zip.arrayBuffer()))
        execFileSync("python", ["-c", "import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; assert z.read('folder/日本語.bin') == bytes([0,255,128,65]); assert z.read('file.txt') == b'hello\\n'; assert z.getinfo('folder/empty/').is_dir()", path])
    } finally { rmSync(dir, { recursive: true, force: true }) }
})
