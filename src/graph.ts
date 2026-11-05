import { readFileSync, existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import type { xml_node } from "./xml.ts"
import type { page, site_model } from "./model.ts"
import { crumb_chain, menu_pages, page_url } from "./model.ts"
import { sha256 } from "./util.ts"
import { page_style_text } from "./web/page_style.tsx"
import { icon_source } from "./web/seo_images.tsx"

export function serialize_node(node: xml_node): string {
    const children = node.children.map(serialize_node).join("")
    return `<${node.tag} ${JSON.stringify(node.attrs)}>${node.text.trim()}${children}</${node.tag}>`
}

function window_sources(model: site_model, page: page): string {
    const found: string[] = []
    const visit = (node: xml_node): void => {
        const path = node.attrs.path
        if (node.tag === "window" && path) {
            const file = model.resources.get(path.replace(/^file:\/\//, ""))
            if (file && existsSync(file)) found.push(readFileSync(file, "utf8"))
        }
        node.children.forEach(visit)
    }
    visit(page.node)
    return found.join("\u0000")
}

// The signature is inlined in every header and the icon source feeds every favicon, touch icon and cover, so both count as shared input.
function signature_text(model: site_model): string {
    const files = [join(model.content_dir, "media", "signature.svg"), icon_source(model) ?? ""]
    const home = model.pages.filter(page => page.path === "/").map(page => `${page.lang}:${page.info}`).join("|")
    return files.map(file => (file && existsSync(file) ? readFileSync(file, "utf8") : "")).join("\u0002") + home
}

export function shared_hash(model: site_model, theme_refs: string): string {
    // Includes generator source changes until the finer source/HEAD manifest lands.
    const source_text = (dir: string): string => readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
        .map(entry => entry.isDirectory() ? source_text(join(dir, entry.name)) : readFileSync(join(dir, entry.name), "utf8")).join("\u0000")
    const parts = [source_text(join(model.root, "src")), signature_text(model), JSON.stringify(model.config), JSON.stringify(model.icons), theme_refs, model.mode]
    return sha256(parts.join("\u0001"))
}

export function page_hash(model: site_model, page: page, shared: string, expertise_key: string): string {
    const chain = crumb_chain(model, page)
    const menus = chain.flatMap(item => menu_pages(model, item.path, page.lang).map(entry => `${page_url(model, entry)}|${entry.name}|${entry.icon}|${entry.rank}`))
    const siblings = model.pages.filter(item => item.path === page.path).map(item => item.lang)
    const objects = page.node.children.some(child => child.tag === "expertise") ? model.objects.map(serialize_node).join("|") : ""
    const parts = [objects, serialize_node(page.node), chain.map(item => item.name).join(">"), menus.join(";"), siblings.join(","), window_sources(model, page), shared, page_style_text(page), expertise_key]
    return sha256(parts.join("\u0001"))
}

export function dependency_graph(model: site_model): { nodes: string[], edges: [string, string][] } {
    const nodes = model.pages.map(page => `page:${page.lang}:${page.path}`)
    const edges: [string, string][] = []
    for (const page of model.pages) {
        const id = `page:${page.lang}:${page.path}`
        for (const crumb of crumb_chain(model, page)) edges.push([`page:${crumb.lang}:${crumb.path}`, id])
        for (const entry of menu_pages(model, page.path, page.lang)) edges.push([`page:${entry.lang}:${entry.path}`, id])
    }
    for (const theme of model.themes) nodes.push(`theme:${theme.attrs.name}`)
    return { nodes, edges }
}
