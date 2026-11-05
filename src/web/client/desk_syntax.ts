// Colour coding for text windows. The language comes from the window's mime type; the text is cut into tokens by a short list of sticky
// regular expressions per language (no parser, so odd input is only ever coloured a little wrong, never rejected). The result is one number
// per character (an index into `token_names`), so the same colouring can be laid over the text view's lines and over its 16-character rows.

export const token_names = ["plain", "comment", "string", "number", "keyword", "type", "func", "var", "meta", "key", "tag", "punct"] as const

type rule = [type: number, pattern: RegExp]

const index = (name: (typeof token_names)[number]): number => token_names.indexOf(name)
const words = (list: string): string => `\\b(?:${list.trim().split(/\s+/).join("|")})\\b`

const C_KEYWORDS = "if else for while do switch case default break continue return goto sizeof typedef struct union enum static extern const volatile inline register auto class public private protected virtual namespace using template typename new delete try catch throw operator this nullptr true false NULL"
const C_TYPES = "void char short int long float double signed unsigned bool size_t uint8_t uint16_t uint32_t uint64_t int8_t int16_t int32_t int64_t string"
const JS_KEYWORDS = "if else for while do switch case default break continue return function class extends new delete typeof instanceof in of var let const async await yield try catch finally throw import export from as default static get set this super null undefined true false void type interface enum implements readonly declare namespace abstract public private protected"
const JS_TYPES = "string number boolean any unknown never object symbol bigint Array Map Set Promise Record"
const PY_KEYWORDS = "and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield True False None self"
const SH_KEYWORDS = "if then else elif fi for while until do done case esac in function select time return exit break continue local export readonly unset source alias echo cd set shift test"

function c_like(keywords: string, types: string, js: boolean): rule[] {
    return [
        [index("comment"), /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/y],
        [index("string"), js ? /"(?:\\[\s\S]|[^"\\\n])*"?|'(?:\\[\s\S]|[^'\\\n])*'?|`(?:\\[\s\S]|[^`\\])*`?/y : /"(?:\\[\s\S]|[^"\\\n])*"?|'(?:\\[\s\S]|[^'\\\n])*'?/y],
        ...(js ? [] : [[index("meta"), /#[ \t]*\w+/y] as rule]),
        [index("number"), /\b(?:0x[\da-f]+|\d+\.?\d*(?:e[+-]?\d+)?)[a-z]*\b/iy],
        [index("keyword"), new RegExp(words(keywords), "y")],
        [index("type"), new RegExp(words(types), "y")],
        [index("func"), /[A-Za-z_$][\w$]*(?=\s*\()/y],
        [0, /[A-Za-z_$][\w$]*/y],
        [index("punct"), /[{}()[\];,.<>=+\-*/%&|^!~?:]+/y],
    ]
}

const languages: Record<string, rule[]> = {
    c: c_like(C_KEYWORDS, C_TYPES, false),
    js: c_like(JS_KEYWORDS, JS_TYPES, true),
    py: [
        [index("comment"), /#[^\n]*/y],
        [index("string"), /"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|"(?:\\[\s\S]|[^"\\\n])*"?|'(?:\\[\s\S]|[^'\\\n])*'?/y],
        [index("meta"), /@[\w.]+/y],
        [index("number"), /\b(?:0x[\da-f]+|\d+\.?\d*(?:e[+-]?\d+)?)j?\b/iy],
        [index("keyword"), new RegExp(words(PY_KEYWORDS), "y")],
        [index("func"), /[A-Za-z_]\w*(?=\s*\()/y],
        [0, /[A-Za-z_]\w*/y],
        [index("punct"), /[{}()[\];,.<>=+\-*/%&|^!~:]+/y],
    ],
    sh: [
        [index("comment"), /#[^\n]*/y],
        [index("string"), /"(?:\\[\s\S]|[^"\\])*"?|'[^']*'?/y],
        [index("var"), /\$\{[^}\n]*\}?|\$\w+|\$[@#?*!$]/y],
        [index("number"), /\b\d+\b/y],
        [index("keyword"), new RegExp(words(SH_KEYWORDS), "y")],
        [0, /[A-Za-z_][\w-]*/y],
        [index("punct"), /[{}()[\];|&<>=!]+/y],
    ],
    json: [
        [index("key"), /"(?:\\[\s\S]|[^"\\\n])*"(?=\s*:)/y],
        [index("string"), /"(?:\\[\s\S]|[^"\\\n])*"?/y],
        [index("number"), /-?\d+\.?\d*(?:e[+-]?\d+)?/iy],
        [index("keyword"), /\b(?:true|false|null)\b/y],
        [index("punct"), /[{}[\]:,]+/y],
    ],
    css: [
        [index("comment"), /\/\*[\s\S]*?(?:\*\/|$)/y],
        [index("string"), /"(?:\\[\s\S]|[^"\\\n])*"?|'(?:\\[\s\S]|[^'\\\n])*'?/y],
        [index("keyword"), /@[\w-]+/y],
        [index("var"), /--[\w-]+/y],
        [index("number"), /#[\da-f]{3,8}\b|-?\d*\.?\d+(?:px|em|rem|%|vh|vw|vmin|vmax|ch|s|ms|deg|fr)?\b/iy],
        [index("key"), /[a-z-]+(?=\s*:(?!\w))/y],
        [index("func"), /[\w-]+(?=\()/y],
        [0, /[\w-]+/y],
        [index("punct"), /[{}()[\];:,>+~*=]+/y],
    ],
    xml: [
        [index("comment"), /<!--[\s\S]*?(?:-->|$)/y],
        [index("meta"), /<[!?][^>]*>?/y],
        [index("tag"), /<\/?[A-Za-z][\w:.-]*|\/?>/y],
        [index("key"), /[\w:.-]+(?=\s*=)/y],
        [index("string"), /"[^"]*"?|'[^']*'?/y],
        [index("var"), /&[#\w]+;/y],
        [index("punct"), /=/y],
    ],
    md: [
        [index("keyword"), /^#{1,6}[^\n]*/my],
        [index("string"), /^```[\s\S]*?(?:^```|(?![\s\S]))|`[^`\n]+`/my],
        [index("comment"), /^>[^\n]*/my],
        [index("type"), /\*\*[^*\n]+\*\*|__[^_\n]+__/y],
        [index("func"), /\[[^\]\n]*\]\([^)\n]*\)/y],
        [index("punct"), /^[ \t]*(?:[-*+]|\d+\.)[ \t]/my],
    ],
    csv: [
        [index("string"), /"(?:[^"]|"")*"?/y],
        [index("number"), /-?\d+\.?\d*/y],
        [index("punct"), /[,;\t]/y],
    ],
}

const by_mime: Record<string, string> = {
    "text/x-c": "c", "text/x-c++src": "c", "text/x-csrc": "c", "text/x-chdr": "c",
    "text/javascript": "js", "application/javascript": "js", "application/typescript": "js", "text/typescript": "js",
    "text/x-python": "py", "text/x-shellscript": "sh", "application/x-sh": "sh",
    "application/json": "json", "text/css": "css",
    "text/html": "xml", "text/xml": "xml", "application/xml": "xml", "image/svg+xml": "xml",
    "text/markdown": "md", "text/csv": "csv",
}

export function language_of(mime: string): string | null {
    if (by_mime[mime]) return by_mime[mime]
    if (/\+xml$/.test(mime)) return "xml"
    if (/\+json$/.test(mime)) return "json"
    return null
}

// Colouring is for ordinary files; a huge one would be re-scanned on every key in the editor.
export const syntax_limit = 300_000

// One token number per UTF-16 unit of `value`, or null when the mime has no language (or the text is too long to be worth it).
export function token_map(value: string, mime: string): Uint8Array | null {
    const language = language_of(mime)
    if (!language || value.length > syntax_limit) return null
    const rules = languages[language]
    const map = new Uint8Array(value.length)
    let at = 0
    while (at < value.length) {
        let hit = false
        for (const [type, pattern] of rules) {
            pattern.lastIndex = at
            const found = pattern.exec(value)
            if (found && found[0].length > 0) {
                if (type !== 0) map.fill(type, at, at + found[0].length)
                at += found[0].length
                hit = true
                break
            }
        }
        if (!hit) at++
    }
    return map
}

// value[from, to) as nodes: plain runs are text, the rest are <span class="tok_name">. `space` turns spaces into no-break spaces (the text view).
export function coloured_nodes(value: string, map: Uint8Array, from: number, to: number, space: boolean): Node[] {
    const nodes: Node[] = []
    let start = from
    while (start < to) {
        const type = map[start]
        let end = start + 1
        while (end < to && map[end] === type) end++
        let piece = value.slice(start, end)
        if (space) piece = piece.replace(/ /g, "\u00a0")
        if (type === 0) nodes.push(document.createTextNode(piece))
        else {
            const span = document.createElement("span")
            span.className = `tok_${token_names[type]}`
            span.textContent = piece
            nodes.push(span)
        }
        start = end
    }
    return nodes
}
