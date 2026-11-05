import { createHash } from "node:crypto"

export function esc_html(text: string): string {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

export function esc_attr(text: string): string {
    return esc_html(text).replace(/"/g, "&quot;")
}

// Private-use characters become numeric entities so the HTML stays plain ASCII for glyph text.
// <script> bodies are left alone: they are not entity-decoded, so an entity there would reach JSON.parse as literal text.
export function to_entities(text: string): string {
    const convert = (part: string): string => part.replace(/[\ue000-\uf8ff\u{f0000}-\u{10ffff}]/gu, char => `&#x${char.codePointAt(0)!.toString(16)};`)
    return text.split(/(<script\b[\s\S]*?<\/script>)/gi).map((part, index) => index % 2 === 1 ? part : convert(part)).join("")
}

// For JSON that sits inside a <script> block: private-use characters become \uXXXX escapes (JSON.parse restores them).
export function json_ascii_pua(json: string): string {
    return json.replace(/[\ue000-\uf8ff]|[\ud800-\udbff][\udc00-\udfff]/g, char => {
        const code = char.codePointAt(0)!
        if (code > 0xffff && code < 0xf0000) return char
        return Array.from(char, unit => "\\u" + unit.charCodeAt(0).toString(16).padStart(4, "0")).join("")
    })
}

export function slugify(text: string): string {
    return text.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
}

export function snake(text: string): string {
    return slugify(text).replace(/-/g, "_")
}

export function sha256(text: string | Uint8Array): string {
    return createHash("sha256").update(text).digest("hex")
}

export function short_hash(text: string | Uint8Array): string {
    return sha256(text).slice(0, 10)
}

export function split_list(text: string | undefined): string[] {
    if (!text) return []
    return text.split(",").map(item => item.trim()).filter(item => item.length > 0)
}

export function round_to(value: number, digits: number): number {
    const factor = 10 ** digits
    return Math.round(value * factor) / factor
}

export function unique<item>(items: item[]): item[] {
    return [...new Set(items)]
}

export type html = import("./web/vnode.tsx").child

type attr_value = string | number | boolean | undefined | null

export function el(tag: string, attrs: Record<string, attr_value>, ...children: (html | html[])[]): html {
    const pairs = Object.entries(attrs).filter(([, value]) => value !== undefined && value !== null && value !== false)
    const text_attrs = pairs.map(([name, value]) => (value === true ? ` ${name}` : ` ${name}="${esc_attr(String(value))}"`))
    return `<${tag}${text_attrs.join("")}>${children.flat().join("")}</${tag}>`
}

export function void_el(tag: string, attrs: Record<string, attr_value>): html {
    const pairs = Object.entries(attrs).filter(([, value]) => value !== undefined && value !== null && value !== false)
    const text_attrs = pairs.map(([name, value]) => (value === true ? ` ${name}` : ` ${name}="${esc_attr(String(value))}"`))
    return `<${tag}${text_attrs.join("")}>`
}

export function css_escape_id(id: string): string {
    return id.replace(/\//g, "\\/")
}

export function normalize_path(path: string): string {
    const clean = "/" + path.trim().replace(/^\/+|\/+$/g, "")
    return clean
}

export function path_depth(path: string): number {
    return path === "/" ? 0 : path.split("/").length - 1
}

export function parent_path(path: string): string {
    if (path === "/") return "/"
    const cut = path.lastIndexOf("/")
    return cut <= 0 ? "/" : path.slice(0, cut)
}
