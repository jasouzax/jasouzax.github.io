/* Packaging contract: duplicate public assets resolve after layers merge and retain reproducible filesystem metadata. */
import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

test("image layers preserve duplicate assets as working relative links with stable timestamps", () => {
    const root = mkdtempSync(join(tmpdir(), "jazu_layers_"))
    try {
        const source = join(root, "source"), layers = join(root, "layers"), merged = join(root, "merged")
        const bytes = Buffer.alloc(100000, 42)
        for (const file of ["build/tool/data.wasm", "dist/assets/wasm/data.wasm"]) {
            mkdirSync(resolve(source, file, ".."), { recursive: true })
            writeFileSync(join(source, file), bytes)
        }
        execFileSync(process.execPath, [resolve("ops/docker/layers.ts"), source, layers])
        for (let index = 0; index < 20; index++) cpSync(join(layers, String(index).padStart(2, "0")), merged, { recursive: true, verbatimSymlinks: true })
        const duplicate = join(merged, "dist/assets/wasm/data.wasm")
        assert.ok(lstatSync(duplicate).isSymbolicLink())
        assert.deepEqual(readFileSync(duplicate), bytes)
        assert.equal(statSync(join(layers, "00/build/tool/data.wasm")).mtimeMs, 0)
        assert.equal(lstatSync(join(layers, "00/dist/assets/wasm/data.wasm")).mtimeMs, 0)
    } finally { rmSync(root, { recursive: true, force: true }) }
})
