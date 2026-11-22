import test from "node:test"
import assert from "node:assert/strict"
import { load_site } from "../../../engine/load/model.ts"
import { load_config } from "../../../shared/config.ts"
import { new_diagnostics } from "../../../shared/diag.ts"

test("/server exists in every language as a noindex desk that starts with one fastfetch window", async () => {
    const root = process.cwd()
    const diag = new_diagnostics()
    const model = load_site(root, await load_config(root), diag, new Date("2026-11-19")) as unknown as { pages: Map<string, unknown> | unknown[] }
    const pages = [...(model.pages instanceof Map ? model.pages.values() : model.pages)] as { path: string, lang: string }[]
    const found = pages.filter(page => page.path === "/server").map(page => page.lang).sort()
    assert.deepEqual(found, ["en", "ja"])
    assert.deepEqual(diag.errors, [])
    const xml = (await import("node:fs")).readFileSync("content/server.xml", "utf8")
    assert.equal((xml.match(/path="server:fastfetch"/g) ?? []).length, 2)
    assert.equal((xml.match(/noindex="true"/g) ?? []).length, 2)
})
