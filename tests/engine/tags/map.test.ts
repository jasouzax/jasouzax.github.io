/** Authored map metadata and no-JavaScript links survive HTML and SPA serialization. */
import { test } from "node:test"
import assert from "node:assert/strict"
import { parseHTML } from "linkedom"
import { load_config } from "../../../shared/config.ts"
import { load_site } from "../../../engine/load/model.ts"
import { new_diagnostics } from "../../../shared/diag.ts"
import { render_map } from "../../../engine/tags/map.tsx"
import { to_html, serialize, deserialize } from "../../../shared/vnode/vnode.tsx"
import type { xml_node } from "../../../shared/content/xml.ts"

test("manual maps keep nested names, positions, edge labels and fallback links", async () => {
    const model = load_site(process.cwd(), await load_config(process.cwd()), new_diagnostics(), new Date("2026-11-23"))
    const ctx = { model, page: model.pages[0], lang: "en", expertise: null }
    const node = (tag: string, attrs: Record<string, string>, children: xml_node[] = []): xml_node => ({ tag, attrs, children, text: "", line: 1, file: "map.xml", parent: null })
    const map = node("map", { layout: "flow" }, [node("node", { id: "root", name: "Parent" }, [node("node", { id: "child", name: "Child", link: "/desk", x: "0", y: "80", info: "<safe>", icon: "/assets/example.svg" })]), node("edge", { from: "root", to: "child", text: "contains" })])
    const output = render_map(ctx, map)
    assert.equal(to_html(deserialize(serialize(output))), to_html(output))
    const { document } = parseHTML(to_html(output))
    const child = document.querySelector('[data-map-node="child"]')!
    assert.equal(child.getAttribute("data-map-parent"), "root")
    assert.equal(child.getAttribute("data-map-x"), "0")
    assert.equal(child.querySelector("a")?.getAttribute("href"), "/desk")
    assert.equal(child.querySelector("p")?.textContent, "<safe>")
    assert.equal(child.querySelector("img")?.getAttribute("src"), "/assets/example.svg")
    assert.equal(child.querySelector(".desk_map_name")?.textContent, "Child")
    assert.equal(document.querySelector("[data-map-from]")?.getAttribute("data-map-text"), "contains")
    assert.equal(document.querySelector("script"), null)
})
