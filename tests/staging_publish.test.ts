/* CLI publication targets must keep staging Pages, R2 objects and fingerprints separate from production. */
import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

test("publish CLI forwards independent staging and production targets and preserves each fingerprint", { timeout: 60000 }, () => {
    const root = mkdtempSync(join(tmpdir(), "jazu_staging_publish_"))
    try {
        mkdirSync(join(root, "dist/assets/wasm"), { recursive: true })
        writeFileSync(join(root, "config.json"), '{"base_url":"https://example.com"}')
        writeFileSync(join(root, "dist/index.html"), "same site bytes")
        // A real oversized input exercises R2 routing as well as the Pages command.
        writeFileSync(join(root, "dist/assets/wasm/large.wasm"), Buffer.alloc(25 * 1024 * 1024 + 1))
        writeFileSync(join(root, "dist/.jazu_output.json"), '["index.html","assets/wasm/large.wasm"]')
        mkdirSync(join(root, "node_modules/wrangler/bin"), { recursive: true })
        writeFileSync(join(root, "node_modules/wrangler/bin/wrangler.js"), `require('fs').appendFileSync('calls.jsonl',JSON.stringify(process.argv.slice(2))+'\\n')`)
        const publish = (branch: string) => execFileSync(process.execPath, [resolve("src/main.ts"), "publish", "--root", root, "--skip_build", "--branch", branch, "--pages_project", `site-${branch}`, "--assets_bucket", `assets-${branch}`, "--state_file", join(root, `${branch}.json`)], { env: { ...process.env, CLOUDFLARE_API_TOKEN: "test-only" }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
        assert.match(publish("staging"), /"deployed":true/)
        const stage_state = readFileSync(join(root, "staging.json"), "utf8")
        assert.match(publish("master"), /"deployed":true/)
        assert.equal(readFileSync(join(root, "staging.json"), "utf8"), stage_state)
        assert.match(publish("staging"), /"reason":"unchanged"/)
        const calls = readFileSync(join(root, "calls.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line) as string[])
        assert.equal(calls.length, 4)
        for (const [offset, branch] of [[0, "staging"], [2, "master"]] as const) {
            assert.deepEqual(calls[offset].slice(0, 4), ["r2", "object", "put", `assets-${branch}/assets/wasm/large.wasm`])
            assert.equal(calls[offset + 1][0], "pages")
            assert.equal(calls[offset + 1][calls[offset + 1].indexOf("--project-name") + 1], `site-${branch}`)
            assert.equal(calls[offset + 1][calls[offset + 1].indexOf("--branch") + 1], branch)
        }
    } finally { rmSync(root, { recursive: true, force: true }) }
})
