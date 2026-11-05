// POSIX regular expressions (basic and extended, as grep and sed write them) translated to the source of a JavaScript RegExp.

const classes: Record<string, string> = {
    alpha: "a-zA-Z", digit: "0-9", alnum: "a-zA-Z0-9", upper: "A-Z", lower: "a-z", space: " \\t\\n\\r\\f\\v", blank: " \\t",
    punct: "!-\\/:-@\\[-`{-~", xdigit: "0-9A-Fa-f", word: "A-Za-z0-9_", cntrl: "\\x00-\\x1f\\x7f", print: "\\x20-\\x7e", graph: "\\x21-\\x7e",
}

// a bracket expression starting at the "[" at `at`; the answer is the JS source and the index after it
function bracket(pattern: string, at: number): { source: string, end: number } {
    let i = at + 1
    let negate = false
    if (pattern[i] === "^") {
        negate = true
        i++
    }
    let body = ""
    let first = true
    while (i < pattern.length && (pattern[i] !== "]" || first)) {
        first = false
        const named = /^\[:([a-z]+):\]/.exec(pattern.slice(i))
        if (named && classes[named[1]]) {
            body += classes[named[1]]
            i += named[0].length
            continue
        }
        const c = pattern[i]
        body += c === "\\" || c === "]" || c === "[" || c === "^" ? "\\" + c : c
        i++
    }
    if (i >= pattern.length) throw new Error("unmatched [")
    return { source: `[${negate ? "^" : ""}${body}]`, end: i + 1 }
}

export function make_regex(pattern: string, extended: boolean): string {
    let out = ""
    let start = true
    for (let i = 0; i < pattern.length; i++) {
        const c = pattern[i]
        if (c === "[") {
            const part = bracket(pattern, i)
            out += part.source
            i = part.end - 1
            start = false
            continue
        }
        if (c === "\\" && i + 1 < pattern.length) {
            const next = pattern[++i]
            if (!extended && "(){}|+?".includes(next)) {
                out += next
                start = next === "(" || next === "|"
                continue
            }
            if (next === "<" || next === ">") out += "\\b"
            else if (next === "'" || next === "`") out += next === "'" ? "$" : "^"
            else if (/[1-9]/.test(next)) out += "\\" + next
            else if ("wWsSdDbBnt".includes(next)) out += "\\" + next
            else out += "\\" + next
            start = false
            continue
        }
        if (!extended && "(){}|+?".includes(c)) {
            out += "\\" + c
            start = false
            continue
        }
        if (c === "*" && start) {
            out += "\\*"
            start = false
            continue
        }
        if (c === "^" && !start && !extended) {
            out += "\\^"
            continue
        }
        out += c
        start = c === "(" || c === "|" || (c === "^" && start)
    }
    return out
}
