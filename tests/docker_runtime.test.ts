/* Container-facing contracts: runtime roles and large static asset streaming/range handling. */
import { test } from "node:test"
import assert from "node:assert/strict"
import { once } from "node:events"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync, symlinkSync, lstatSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { docker_options, refresh_content, restore_inputs } from "../ops/docker/entry.ts"
import { serve } from "../src/node/serve.ts"

test("Docker defaults serve the website and personal mode selects its own port and persistent directory", () => {
    assert.equal(docker_options([]).port, 8080)
    assert.equal(docker_options(["--personal-server"]).port, 8788)
    assert.equal(docker_options(["--personal-server", "--no-runner"]).runner, false)
    assert.equal(docker_options(["--content=/content", "--port", "9000"]).content, "/content")
    assert.throws(() => docker_options(["--port=0"]), /port/)
    assert.throws(() => docker_options(["--content"]), /Missing/)
})

test("standalone hosting streams complete assets with HEAD and valid ranges without relying on R2", async () => {
    const root = mkdtempSync(join(tmpdir(), "jazu_docker_web_"))
    writeFileSync(join(root, "movie.mp4"), "0123456789")
    writeFileSync(join(root, "empty.txt"), "")
    const server = serve(root, 0, "0.0.0.0")
    await once(server, "listening")
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    try {
        assert.equal((await (await fetch(url + "/api/v1/health")).json()).status, "ok")
        const partial = await fetch(url + "/movie.mp4", { headers: { range: "bytes=2-5" } })
        assert.equal(partial.status, 206)
        assert.equal(partial.headers.get("content-range"), "bytes 2-5/10")
        assert.equal(await partial.text(), "2345")
        const head = await fetch(url + "/movie.mp4", { method: "HEAD" })
        assert.equal(head.headers.get("content-length"), "10")
        assert.equal(await head.text(), "")
        assert.equal(await (await fetch(url + "/movie.mp4", { headers: { range: "bytes=-3" } })).text(), "789")
        assert.equal((await fetch(url + "/movie.mp4", { headers: { range: "bytes=50-" } })).status, 416)
        assert.equal(await (await fetch(url + "/empty.txt")).text(), "")
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(root, { recursive: true, force: true }) }
})


test("custom content refresh removes deleted resources without changing the source", () => {
    const root = mkdtempSync(join(tmpdir(), "jazu_custom_refresh_"))
    const source = join(root, "source"), work = join(root, "work")
    mkdirSync(source)
    try {
        writeFileSync(join(source, "kept.txt"), "first")
        writeFileSync(join(source, "removed.txt"), "old")
        refresh_content(source, work)
        rmSync(join(source, "removed.txt"))
        writeFileSync(join(source, "kept.txt"), "second")
        refresh_content(source, work)
        assert.equal(existsSync(join(work, "content/removed.txt")), false)
        assert.equal(readFileSync(join(work, "content/kept.txt"), "utf8"), "second")
        assert.equal(readFileSync(join(source, "kept.txt"), "utf8"), "second")
    } finally { rmSync(root, { recursive: true, force: true }) }
})


test("personal bootstrap restores missing artifacts into tracked build directories without replacing newer source or media", () => {
    const root = mkdtempSync(join(tmpdir(), "jazu_restore_inputs_"))
    const image = join(root, "image"), work = join(root, "work")
    try {
        for (const path of ["build/tool/custom", "content/media"]) {
            mkdirSync(join(image, path), { recursive: true }); mkdirSync(join(work, path), { recursive: true })
        }
        writeFileSync(join(image, "build/tool/custom/tool.c"), "image source")
        writeFileSync(join(work, "build/tool/custom/tool.c"), "newer Git source")
        writeFileSync(join(image, "build/tool/tool.wasm"), "compiled artifact")
        writeFileSync(join(image, "content/media/photo.png"), "image photo")
        writeFileSync(join(work, "content/media/photo.png"), "owner photo")
        mkdirSync(join(image, "build/alias/custom"), { recursive: true })
        mkdirSync(join(work, "build/alias/custom"), { recursive: true })
        symlinkSync("../../tool/custom/tool.c", join(image, "build/alias/custom/tool.c"), "file")
        writeFileSync(join(work, "build/alias/custom/tool.c"), "newer alias source")
        symlinkSync("missing", join(work, "build/tool/owner-link"), "file")
        writeFileSync(join(image, "build/tool/owner-link"), "image file")
        symlinkSync("tool.wasm", join(image, "build/tool/shared.wasm"), "file")
        symlinkSync(join(image, "build/tool/tool.wasm"), join(work, "build/tool/image-link.wasm"), "file")
        writeFileSync(join(image, "build/tool/image-link.wasm"), "repaired artifact")
        restore_inputs(image, work)
        assert.equal(lstatSync(join(work, "build/tool/shared.wasm")).isSymbolicLink(), false)
        assert.equal(readFileSync(join(work, "build/tool/shared.wasm"), "utf8"), "compiled artifact")
        assert.equal(lstatSync(join(work, "build/tool/image-link.wasm")).isSymbolicLink(), false)
        assert.equal(readFileSync(join(work, "build/tool/image-link.wasm"), "utf8"), "repaired artifact")
        assert.equal(readFileSync(join(work, "build/alias/custom/tool.c"), "utf8"), "newer alias source")
        assert.ok(lstatSync(join(work, "build/tool/owner-link")).isSymbolicLink())
        assert.equal(readFileSync(join(work, "build/tool/tool.wasm"), "utf8"), "compiled artifact")
        assert.equal(readFileSync(join(work, "build/tool/custom/tool.c"), "utf8"), "newer Git source")
        assert.equal(readFileSync(join(work, "content/media/photo.png"), "utf8"), "owner photo")
    } finally { rmSync(root, { recursive: true, force: true }) }
})


test("custom snapshots materialize internal links and reject links escaping the content directory", () => {
    const root = mkdtempSync(join(tmpdir(), "jazu_content_links_")), source = join(root, "source"), work = join(root, "work")
    mkdirSync(source)
    try {
        writeFileSync(join(source, "photo.txt"), "public image")
        symlinkSync("photo.txt", join(source, "alias.txt"), "file")
        refresh_content(source, work)
        assert.equal(lstatSync(join(work, "content/alias.txt")).isSymbolicLink(), false)
        assert.equal(readFileSync(join(work, "content/alias.txt"), "utf8"), "public image")
        writeFileSync(join(root, "private.txt"), "private")
        symlinkSync(join(root, "private.txt"), join(source, "outside.txt"), "file")
        assert.throws(() => refresh_content(source, work), /symlink escapes/)
        assert.equal(existsSync(join(work, "content/outside.txt")), false)
        assert.equal(readFileSync(join(work, "content/photo.txt"), "utf8"), "public image")
    } finally { rmSync(root, { recursive: true, force: true }) }
})
