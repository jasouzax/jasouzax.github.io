import { parseFragment } from "parse5"
import { jsx, fragment, raw_text, type child } from "./vnode.tsx"

// Explicit build-only boundary for trusted signature SVG and Markdown rendered
// with HTML disabled. Raw markup never appears in a browser page payload.
export function raw(source: string): child {
    const convert = (node: any, literal = false): child => {
        if (node.nodeName === "#text") return literal ? raw_text(node.value) : node.value
        if (!node.tagName) return (node.childNodes ?? []).map((child: any) => convert(child))
        const attrs = Object.fromEntries(
            (node.attrs ?? []).map((attr: any) => [
                attr.prefix ? `${attr.prefix}:${attr.name}` : attr.name,
                attr.value
            ])
        )
        return jsx(
            node.tagName,
            attrs,
            ...(node.content?.childNodes ?? node.childNodes ?? []).map((child: any) =>
                convert(child, ["script", "style"].includes(node.tagName))
            )
        )
    }
    return jsx(fragment, null, convert(parseFragment(source)))
}
