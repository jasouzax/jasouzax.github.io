import { SaxesParser } from "saxes"
import { jazu_error } from "./diag.ts"

export type xml_node = {
    tag: string
    attrs: Record<string, string>
    children: xml_node[]
    text: string
    line: number
    file: string
    parent: xml_node | null
}

export function parse_xml(source: string, file: string): xml_node[] {
    const parser = new SaxesParser({ xmlns: false, position: true })
    const wrapper: xml_node = { tag: "jazu", attrs: {}, children: [], text: "", line: 0, file, parent: null }
    let current = wrapper
    parser.on("error", error => {
        throw new jazu_error(`${file}:${parser.line}: ${error.message}`, 1)
    })
    parser.on("opentag", tag => {
        const node: xml_node = { tag: tag.name, attrs: { ...tag.attributes } as Record<string, string>, children: [], text: "", line: parser.line, file, parent: current }
        current.children.push(node)
        current = node
    })
    parser.on("closetag", () => {
        current = current.parent!
    })
    parser.on("text", text => {
        current.text += text
    })
    parser.on("cdata", text => {
        current.text += text
    })
    parser.write("<jazu>" + source.replace(/^\ufeff/, "").replace(/<\?xml[^>]*\?>/, "").replace(/&#(?:91|x0*5b);/gi, "\ufdd0") + "</jazu>").close()
    return wrapper.children[0].children
}

export function child_nodes(node: xml_node, tag: string): xml_node[] {
    return node.children.filter(child => child.tag === tag)
}

export function walk_nodes(node: xml_node, visit: (node: xml_node) => void): void {
    visit(node)
    for (const child of node.children) walk_nodes(child, visit)
}

export function where_of(node: xml_node): string {
    return `${node.file}:${node.line} <${node.tag}>`
}
