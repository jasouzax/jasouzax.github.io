/* Markdown tokens become the same safe virtual nodes in static pages and browser windows. */
import MarkdownIt from "markdown-it"
import { jsx, type child } from "./vnode/vnode.tsx"

const parser = new MarkdownIt({ html: false, linkify: true })
type Token = ReturnType<typeof parser.parse>[number]

function image_alt(tokens: Token[]): string {
    return tokens.map(token => token.children ? image_alt(token.children) : ["text", "code_inline"].includes(token.type) ? token.content : token.type === "softbreak" ? "\n" : "").join("")
}

function render_tokens(tokens: Token[]): child[] {
    const root: child[] = [], stack = [root]
    for (const token of tokens) {
        if (token.hidden) continue
        if (token.nesting === -1) {
            if (stack.length > 1) stack.pop()
            if (token.block) stack.at(-1)!.push("\n")
            continue
        }
        const output = stack.at(-1)!
        if (token.type === "inline") { output.push(...render_tokens(token.children ?? [])); continue }
        if (token.type === "text") { output.push(token.content); continue }
        if (token.type === "softbreak") { output.push("\n"); continue }
        if (token.type === "hardbreak") { output.push(jsx("br", null)); continue }
        if (["fence", "code_block"].includes(token.type)) {
            const language = token.info.trim().split(/\s+/)[0]
            output.push(jsx("pre", null, jsx("code", language ? { class: `language-${language}` } : null, token.content)), "\n")
            continue
        }
        if (token.type === "code_inline") { output.push(jsx("code", null, token.content)); continue }
        const attrs = Object.fromEntries(token.attrs ?? [])
        if (token.type === "image") attrs.alt = image_alt(token.children ?? []) || token.content
        if (!token.tag) { output.push(token.content); continue }
        const node = jsx(token.tag, attrs)
        output.push(node)
        if (token.nesting === 1) stack.push(node.children)
        else if (token.block) output.push("\n")
    }
    return root
}

export function markdown_nodes(source: string): child[] { return render_tokens(parser.parse(source, {})) }
