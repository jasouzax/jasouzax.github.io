export type attributes = Record<string, string | number | boolean | null | undefined>
export type vnode = { tag: string | null; attrs: attributes; children: child[] }
export type literal_text = { literal_text: string }
export type child = vnode | literal_text | string | number | boolean | null | undefined | child[]
export type serialized_node = string | number | [string | null, attributes, ...serialized_node[]]
export const fragment = Symbol("fragment")

declare global {
    namespace JSX {
        type Element = vnode
        interface ElementChildrenAttribute {
            children: {}
        }
        interface IntrinsicElements {
            [name: string]: Record<string, unknown>
        }
    }
}

export function jsx(
    tag: string | typeof fragment | ((props: Record<string, unknown> & { children: child[] }) => child),
    attrs: attributes | null,
    ...children: child[]
): vnode {
    if (typeof tag === "function") return jsx(fragment, null, tag({ ...attrs, children }))
    for (const [name, value] of Object.entries(attrs ?? {})) {
        if (value !== null && typeof value === "object")
            throw new Error(`Attribute ${name} must be a scalar value`)
        if (/^on/i.test(name)) throw new Error("Event attributes are not allowed in virtual nodes")
    }
    const flat: child[] = []
    const append = (item: child): void => {
        if (Array.isArray(item)) item.forEach(append)
        else flat.push(item)
    }
    children.forEach(append)
    return { tag: tag === fragment ? null : tag, attrs: attrs ?? {}, children: flat }
}
export const raw_text = (value: string): literal_text => ({ literal_text: value })
const escape_text = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
const boolean_attrs = new Set(
    "allowfullscreen async autofocus autoplay checked controls default defer disabled download formnovalidate hidden inert ismap itemscope loop multiple muted nomodule novalidate open playsinline readonly required reversed selected".split(
        " "
    )
)
const void_tags = new Set("area base br col embed hr img input link meta param source track wbr".split(" "))
const name_of = (name: string) =>
    ({ className: "class", htmlFor: "for", tabIndex: "tabindex", readOnly: "readonly" })[name] ?? name
function attribute_entries(attrs: attributes): [string, string | number | boolean][] {
    return Object.entries(attrs)
        .filter(
            (entry): entry is [string, string | number | boolean] =>
                entry[1] !== null && entry[1] !== undefined
        )
        .map(([name, value]) => [name_of(name), value] as [string, string | number | boolean])
        .filter(([name, value]) => value !== false || !boolean_attrs.has(name))
}
export function to_html(node: child): string {
    if (node === null || node === undefined || typeof node === "boolean") return ""
    if (Array.isArray(node)) return node.map(to_html).join("")
    if (typeof node === "string" || typeof node === "number") return escape_text(String(node))
    if ("literal_text" in node) return node.literal_text
    if (node.tag === null) return node.children.map(to_html).join("")
    const attrs = attribute_entries(node.attrs)
        .map(([name, value]) =>
            value === true && boolean_attrs.has(name)
                ? ` ${name}`
                : ` ${name}="${escape_text(String(value)).replace(/"/g, "&quot;")}"`
        )
        .join("")
    return `<${node.tag}${attrs}>${void_tags.has(node.tag) ? "" : node.children.map(to_html).join("") + `</${node.tag}>`}`
}
export function serialize(node: child): serialized_node {
    if (node === null || node === undefined || typeof node === "boolean") return ""
    if (typeof node === "string" || typeof node === "number") return node
    if (Array.isArray(node)) return [null, {}, ...node.map(serialize)]
    if ("literal_text" in node) return node.literal_text
    return [node.tag, Object.fromEntries(attribute_entries(node.attrs)), ...node.children.map(serialize)]
}
export function deserialize(tree: serialized_node): child {
    if (!Array.isArray(tree)) return tree
    const [tag, attrs, ...children] = tree
    return { tag, attrs, children: children.map(deserialize) }
}
export function to_dom(
    node: child,
    document_api: Document = document,
    namespace = "http://www.w3.org/1999/xhtml"
): Node {
    if (node === null || node === undefined || typeof node === "boolean")
        return document_api.createTextNode("")
    if (typeof node === "string" || typeof node === "number") return document_api.createTextNode(String(node))
    if (!Array.isArray(node) && "literal_text" in node) return document_api.createTextNode(node.literal_text)
    if (Array.isArray(node) || node.tag === null) {
        const output = document_api.createDocumentFragment()
        for (const child of Array.isArray(node) ? node : node.children)
            output.appendChild(to_dom(child, document_api, namespace))
        return output
    }
    const ns = node.tag === "svg" ? "http://www.w3.org/2000/svg" : namespace
    const element = document_api.createElementNS(ns, node.tag)
    for (const [name, value] of attribute_entries(node.attrs)) {
        // These are serialized first-party components; an event listener is never
        // represented by an HTML attribute or evaluated from a string.
        if (/^on/i.test(name)) throw new Error("Event attributes are not allowed in virtual nodes")
        if (name.startsWith("xlink:"))
            element.setAttributeNS("http://www.w3.org/1999/xlink", name, String(value))
        else element.setAttribute(name, value === true && boolean_attrs.has(name) ? "" : String(value))
    }
    const container = node.tag === "template" ? (element as HTMLTemplateElement).content : element
    for (const child of node.children)
        container.appendChild(
            to_dom(child, document_api, node.tag === "foreignObject" ? "http://www.w3.org/1999/xhtml" : ns)
        )
    return element
}
