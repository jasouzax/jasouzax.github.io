/* Nested blog identities remain sibling-relative in XML and absolute in generated routes. */
import type { xml_node } from "../../shared/content/xml.ts"

export function blog_id(node: xml_node): string {
    return node.parent?.tag === "blog" ? `${blog_id(node.parent)}/${node.attrs.id}` : node.attrs.id
}

export function public_blogs(node: xml_node, lang: string): xml_node[] {
    if (node.attrs.private === "true") return []
    node.attrs.lang ??= lang
    node.children = node.children.filter(child => child.attrs.private !== "true")
    return [node, ...node.children.filter(child => child.tag === "blog").flatMap(child => public_blogs(child, node.attrs.lang))]
}
