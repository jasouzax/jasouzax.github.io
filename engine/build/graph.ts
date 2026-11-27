import { readFileSync, existsSync } from "node:fs"
import { join, relative } from "node:path"
import type { xml_node } from "../../shared/content/xml.ts"
import type { page, site_model } from "../load/model.ts"
import { crumb_chain, menu_pages, page_url } from "../load/model.ts"
import { sha256 } from "../../shared/util.ts"
import { page_style_text } from "../style/page.tsx"
import { icon_source } from "../seo/cover.tsx"
import { configured_resource } from "../load/resources.ts"
import { book_chapters } from "../tags/print/book.tsx"
import { select_print } from "../tags/print/model.ts"
import { Source_Manifest } from "../load/manifest.ts"

function printed_chapters(model: site_model, page: page): page[] {
    const layout = select_print(model, page)
    return (layout?.attrs.layout ?? layout?.attrs.name) === "book" ? book_chapters({ model, page, lang: page.lang, expertise: null }) : []
}

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
            if (file && existsSync(file)) found.push(model.sources?.hash(file) ?? sha256(readFileSync(file)))
        }
        node.children.forEach(visit)
    }
    visit(page.node)
    return found.join("\u0000")
}

// The signature is inlined in every header and the icon source feeds every favicon, touch icon and cover, so both count as shared input.
function signature_text(model: site_model): string {
    const files = [configured_resource(model, "signature"), icon_source(model), configured_resource(model, "favicon")]
    const home = model.pages.filter(page => page.path === "/").map(page => `${page.lang}:${page.info}`).join("|")
    return files.map(file => (file && existsSync(file) ? readFileSync(file, "utf8") : "")).join("\u0002") + home
}

export function shared_hash(model: site_model, theme_refs: string): string {
    const sources = model.sources ?? new Source_Manifest(model.root)
    const parts = [["engine", "desk", "shared"].map(name => sources.tree(join(model.root, name))).join("\u0000"), signature_text(model), JSON.stringify(model.config), JSON.stringify(model.icons), theme_refs, model.mode]
    sources.save()
    return sha256(parts.join("\u0001"))
}

export function page_hash(model: site_model, page: page, shared: string, expertise_key: string, styles_key = ""): string {
    const chain = crumb_chain(model, page)
    const menus = chain.flatMap(item => menu_pages(model, item.path, page.lang).map(entry => `${page_url(model, entry)}|${entry.name}|${entry.icon}|${entry.rank}`))
    const siblings = model.pages.filter(item => item.path === page.path).map(item => item.lang)
    const objects = page.node.children.some(child => child.tag === "expertise") || page.node.attrs.print ? expertise_key : ""
    const book = printed_chapters(model, page).map(chapter => [chapter.path, serialize_node(chapter.node), window_sources(model, chapter)].join("\u0000")).join("\u0002")
    const print = select_print(model, page)
    const person = print ? model.pages.find(item => item.path === "/" && item.lang === page.lang) ?? model.pages.find(item => item.path === "/" && item.lang === model.config.default_language) : undefined
    const hero = person?.node.children.find(node => node.tag === "hero")
    const parts = [objects, serialize_node(page.node), book, print ? serialize_node(print) : "", hero ? serialize_node(hero) : "", chain.map(item => item.name).join(">"), menus.join(";"), siblings.join(","), window_sources(model, page), shared, page_style_text(page), styles_key]
    return sha256(parts.join("\u0001"))
}

export function dependency_graph(model: site_model): { nodes: string[], edges: [string, string][] } {
    const nodes = model.pages.map(page => `page:${page.lang}:${page.path}`)
    const edges: [string, string][] = []
    for (const page of model.pages) {
        const id = `page:${page.lang}:${page.path}`
        const source = `source:${page.file.replace(/\\/g, "/")}`
        nodes.push(source); edges.push([source, id])
        for (const crumb of crumb_chain(model, page)) edges.push([`page:${crumb.lang}:${crumb.path}`, id])
        for (const entry of menu_pages(model, page.path, page.lang)) edges.push([`page:${entry.lang}:${entry.path}`, id])
        for (const chapter of printed_chapters(model, page)) if (chapter !== page) edges.push([`page:${chapter.lang}:${chapter.path}`, id])
        const visit = (node: xml_node) => {
            const file = node.tag === "window" && node.attrs.path ? model.resources.get(node.attrs.path.replace(/^file:\/\//, "")) : undefined
            if (file) { const source = `source:${relative(model.root, file).replace(/\\/g, "/")}`; nodes.push(source); edges.push([source, id]) }
            node.children.forEach(visit)
        }
        visit(page.node)
        const print = select_print(model, page)
        if (print) {
            const source = `source:${relative(model.root, print.file).replace(/\\/g, "/")}`; nodes.push(source); edges.push([source, id])
            const person = model.pages.find(item => item.path === "/" && item.lang === page.lang) ?? model.pages.find(item => item.path === "/" && item.lang === model.config.default_language)
            if (person && person !== page) edges.push([`page:${person.lang}:${person.path}`, id])
        }
    }
    for (const theme of model.themes) nodes.push(`theme:${theme.attrs.name}`)
    return { nodes: [...new Set(nodes)], edges: [...new Map(edges.map(edge => [JSON.stringify(edge), edge])).values()] }
}
