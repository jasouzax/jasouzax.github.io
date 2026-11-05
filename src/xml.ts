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

// Expand bare attributes only in start tags. Text, quoted values, comments,
// CDATA and declarations remain byte-for-byte unchanged for the XML parser.
function boolean_attributes(source: string): string {
    let output = "", at = 0
    while (at < source.length) {
        const start = source.indexOf("<", at)
        if (start < 0) return output + source.slice(at)
        output += source.slice(at, start)
        const terminator = source.startsWith("<!--", start) ? "-->" : source.startsWith("<![CDATA[", start) ? "]]>" : source.startsWith("<?", start) ? "?>" : null
        if (terminator) {
            const end = source.indexOf(terminator, start + 2)
            if (end < 0) return output + source.slice(start)
            at = end + terminator.length
            output += source.slice(start, at)
            continue
        }
        const name = /^<[\p{L}_:][\p{L}\p{N}_.:-]*/u.exec(source.slice(start))
        if (!name) {
            // Skip closing tags and declarations, including a DOCTYPE subset.
            let end = start + 1, quote = "", depth = 0
            for (; end < source.length; end++) {
                const char = source[end]
                if (quote) { if (char === quote) quote = "" }
                else if (char === '"' || char === "'") quote = char
                else if (char === "[") depth++
                else if (char === "]") depth--
                else if (char === ">" && depth === 0) { end++; break }
            }
            output += source.slice(start, end)
            at = end
            continue
        }
        output += name[0]
        at = start + name[0].length
        while (at < source.length) {
            const space = /^\s*/.exec(source.slice(at))![0]
            output += space
            at += space.length
            if (source[at] === ">" || source[at] === "/") {
                const end = source.indexOf(">", at)
                if (end < 0) return output + source.slice(at)
                output += source.slice(at, end + 1)
                at = end + 1
                break
            }
            const attr = /^[^\s=<>/"']+/.exec(source.slice(at))?.[0]
            if (!attr) return output + source.slice(at) // let Saxes report malformed XML
            output += attr
            at += attr.length
            const after = at + /^\s*/.exec(source.slice(at))![0].length
            if (source[after] !== "=") { output += '="true"'; continue }
            let end = after + 1
            while (/\s/.test(source[end] ?? "") && end < source.length) end++
            const quote = source[end]
            if (quote !== '"' && quote !== "'") return output + source.slice(at)
            const close = source.indexOf(quote, end + 1)
            if (close < 0) return output + source.slice(at)
            output += source.slice(at, close + 1)
            at = close + 1
        }
    }
    return output
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
    parser.write("<jazu>" + boolean_attributes(source.replace(/^\ufeff/, "").replace(/^(\s*)<\?xml[^>]*\?>/, "$1")).replace(/&#(?:91|x0*5b);/gi, "\ufdd0") + "</jazu>").close()
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
