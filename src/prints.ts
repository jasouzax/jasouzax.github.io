import type { page, site_model } from "./model.ts"
import type { xml_node } from "./xml.ts"
import { element } from "./objects.ts"

export function select_print(model: site_model, page: page): xml_node | undefined {
    const candidates = model.prints.filter(node => node.attrs.name === page.node.attrs.print)
    const score = (node: xml_node): number => Math.max(-1, ...(node.attrs.lang ?? "*").split(",").map(value => {
        const lang = value.trim()
        return lang === page.lang ? 1000 : lang === "*" ? 0 : lang.endsWith("*") && page.lang.startsWith(lang.slice(0, -1)) ? lang.length : -1
    }))
    return candidates.filter(node => score(node) >= 0).sort((a, b) => score(b) - score(a))[0]
}

export function print_person(model: site_model, page: page): xml_node {
    const home = model.pages.find(item => item.path === "/" && item.lang === page.lang)
        ?? model.pages.find(item => item.path === "/" && item.lang === model.config.default_language)
    const hero = home?.node.children.find(node => node.tag === "hero")
    const attrs: Record<string, string> = { name: hero?.attrs.name ?? "", photo: hero?.attrs.profile ?? "" }
    for (const item of hero?.children ?? []) {
        if (item.tag === "item" && item.attrs.print) attrs[item.attrs.print] = item.attrs.text ?? ""
    }
    return element("resume", attrs, hero ?? page.node)
}
