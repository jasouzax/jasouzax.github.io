/* Container-facing contracts: runtime roles and large static asset streaming/range handling. */
import { test } from "node:test"
import assert from "node:assert/strict"
import { once } from "node:events"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { docker_options } from "../ops/docker/entry.ts"
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
