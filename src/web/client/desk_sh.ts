// The shell of the desk's processes (`sh`): a POSIX-style command language over the virtual file system. It reads a line at a time from a
// terminal or a whole script, understands quotes, variables ($x ${x:-y} $(cmd) $((1+2))), pipes, redirections, && || ; &, globs, if / for /
// while / until / case, functions, and starts every program as a process with its own pid (client_kernel.ts). Part of the lazily loaded
// shell runtime (client_desk_shell.ts), not of the page bundle.

import type { fs_api, proc_api, program, text_stream } from "./proc_types.ts"

// ---- paths ------------------------------------------------------------------------------------------------------------------------

export function normalize(path: string): string {
    const parts: string[] = []
    for (const part of path.split("/")) {
        if (part === "" || part === ".") continue
        if (part === "..") parts.pop()
        else parts.push(part)
    }
    return "/" + parts.join("/")
}

export function absolute(cwd: string, path: string): string {
    return normalize(path.startsWith("/") ? path : `${cwd}/${path}`)
}

export function base_name(path: string): string {
    return path.replace(/\/+$/, "").split("/").pop() || "/"
}

export function dir_name(path: string): string {
    const clean = path.replace(/\/+$/, "")
    const at = clean.lastIndexOf("/")
    return at < 0 ? "." : at === 0 ? "/" : clean.slice(0, at)
}

// ---- syntax tree ------------------------------------------------------------------------------------------------------------------

type redir = { fd: number, op: ">" | ">>" | "<" | ">&" | "<&", target: string }
type simple = { t: "simple", assigns: { name: string, value: string }[], words: string[], redirs: redir[] }
type node =
    | simple
    | { t: "if", branches: { test: list, body: list }[], other: list | null, redirs: redir[] }
    | { t: "while", test: list, body: list, until: boolean, redirs: redir[] }
    | { t: "for", name: string, words: string[] | null, body: list, redirs: redir[] }
    | { t: "case", word: string, items: { patterns: string[], body: list }[], redirs: redir[] }
    | { t: "group", body: list, sub: boolean, redirs: redir[] }
    | { t: "func", name: string, body: node }
type pipeline = { cmds: node[], neg: boolean }
type and_or = { first: pipeline, rest: { op: "&&" | "||", pl: pipeline }[] }
type list = { items: { chain: and_or, bg: boolean }[] }

export class Incomplete extends Error {}
export class SyntaxFail extends Error {}

// ---- lexer ------------------------------------------------------------------------------------------------------------------------

type token = { t: "word", raw: string } | { t: "op", op: string } | { t: "redir", fd: number, op: redir["op"] } | { t: "nl" }

// reads a quoted or substituted part of a word starting at `at`; the answer is the index after it
function scan_part(src: string, at: number): number {
    const ch = src[at]
    if (ch === "'") {
        const end = src.indexOf("'", at + 1)
        if (end < 0) throw new Incomplete("quote")
        return end + 1
    }
    if (ch === '"') {
        let i = at + 1
        while (i < src.length && src[i] !== '"') {
            if (src[i] === "\\") i += 2
            else if (src[i] === "$" || src[i] === "`") i = scan_part(src, i)
            else i++
        }
        if (i >= src.length) throw new Incomplete("quote")
        return i + 1
    }
    if (ch === "`") {
        let i = at + 1
        while (i < src.length && src[i] !== "`") i += src[i] === "\\" ? 2 : 1
        if (i >= src.length) throw new Incomplete("backquote")
        return i + 1
    }
    if (ch === "$" && src[at + 1] === "(") {
        const double = src[at + 2] === "("
        let depth = 1
        let i = at + 2
        while (i < src.length && depth > 0) {
            const c = src[i]
            if (c === "'" || c === '"' || c === "`") i = scan_part(src, i)
            else if (c === "\\") i += 2
            else if (c === "$" && src[i + 1] === "(") i = scan_part(src, i)
            else {
                if (c === "(") depth++
                else if (c === ")") depth--
                i++
            }
        }
        if (depth > 0) throw new Incomplete("paren")
        return double ? i : i
    }
    if (ch === "$" && src[at + 1] === "{") {
        let i = at + 2
        while (i < src.length && src[i] !== "}") i += src[i] === "'" || src[i] === '"' ? scan_part(src, i) - i : 1
        if (i >= src.length) throw new Incomplete("brace")
        return i + 1
    }
    return at + 1
}

export function lex(src: string): token[] {
    const tokens: token[] = []
    let i = 0
    while (i < src.length) {
        const ch = src[i]
        if (ch === "\n") {
            tokens.push({ t: "nl" })
            i++
            continue
        }
        if (ch === " " || ch === "\t" || ch === "\r") {
            i++
            continue
        }
        if (ch === "\\" && src[i + 1] === "\n") {
            i += 2
            continue
        }
        if (ch === "#") {
            while (i < src.length && src[i] !== "\n") i++
            continue
        }
        if (ch === "&" && src[i + 1] === "&") { tokens.push({ t: "op", op: "&&" }); i += 2; continue }
        if (ch === "|" && src[i + 1] === "|") { tokens.push({ t: "op", op: "||" }); i += 2; continue }
        if (ch === ";" && src[i + 1] === ";") { tokens.push({ t: "op", op: ";;" }); i += 2; continue }
        if ("|;&()".includes(ch)) {
            tokens.push({ t: "op", op: ch })
            i++
            continue
        }
        if (ch === ">" || ch === "<") {
            const two = src.slice(i, i + 2)
            const op = two === ">>" ? ">>" : two === ">&" ? ">&" : two === "<&" ? "<&" : ch
            tokens.push({ t: "redir", fd: ch === ">" ? 1 : 0, op: op as redir["op"] })
            i += op.length
            continue
        }
        // a word
        let j = i
        while (j < src.length) {
            const c = src[j]
            if (c === "\\") {
                if (j + 1 >= src.length) throw new Incomplete("backslash")
                j += 2
            } else if (c === "'" || c === '"' || c === "`" || c === "$") j = scan_part(src, j)
            else if (" \t\r\n|;&()<>".includes(c)) break
            else j++
        }
        const raw = src.slice(i, j)
        // 2>file: a number right before a redirection is its file descriptor
        if (/^[0-9]+$/.test(raw) && (src[j] === ">" || src[j] === "<")) {
            const two = src.slice(j, j + 2)
            const op = two === ">>" ? ">>" : two === ">&" ? ">&" : two === "<&" ? "<&" : src[j]
            tokens.push({ t: "redir", fd: Number(raw), op: op as redir["op"] })
            i = j + op.length
            continue
        }
        tokens.push({ t: "word", raw })
        i = j
    }
    return tokens
}

// ---- parser -----------------------------------------------------------------------------------------------------------------------

const reserved = new Set(["if", "then", "elif", "else", "fi", "for", "in", "do", "done", "while", "until", "case", "esac", "{", "}", "!"])

class parser {
    at = 0
    constructor(private tokens: token[]) {}

    peek(): token | undefined { return this.tokens[this.at] }
    word_is(raw: string): boolean {
        const token = this.peek()
        return token?.t === "word" && token.raw === raw
    }
    op_is(op: string): boolean {
        const token = this.peek()
        return token?.t === "op" && token.op === op
    }
    skip_newlines(): void {
        while (this.peek()?.t === "nl") this.at++
    }
    expect_word(raw: string): void {
        this.skip_newlines()
        if (this.peek() === undefined) throw new Incomplete(raw)
        if (!this.word_is(raw)) throw new SyntaxFail(`expected '${raw}'`)
        this.at++
    }

    program(): list {
        const body = this.list(() => false)
        if (this.peek() !== undefined) throw new SyntaxFail(`unexpected '${this.describe()}'`)
        return body
    }

    describe(): string {
        const token = this.peek()
        return !token ? "end of file" : token.t === "word" ? token.raw : token.t === "op" ? token.op : token.t === "redir" ? "redirection" : "newline"
    }

    // a list ends where `stop` says (a closing keyword or bracket); stop() is only asked at the start of a command
    list(stop: () => boolean): list {
        const items: list["items"] = []
        for (;;) {
            while (this.peek()?.t === "nl" || this.op_is(";")) this.at++
            if (this.peek() === undefined || stop()) break
            const chain = this.and_or()
            let bg = false
            let separated = false
            if (this.op_is("&")) {
                bg = true
                separated = true
                this.at++
            } else if (this.op_is(";")) {
                separated = true
                this.at++
            }
            items.push({ chain, bg })
            const next = this.peek()
            if (!separated && next !== undefined && next.t !== "nl" && !stop()) {
                if (next.t === "op" && (next.op === ")" || next.op === ";;")) break
                throw new SyntaxFail(`unexpected '${this.describe()}'`)
            }
        }
        return { items }
    }

    and_or(): and_or {
        const first = this.pipeline()
        const rest: and_or["rest"] = []
        for (;;) {
            const token = this.peek()
            if (token?.t === "op" && (token.op === "&&" || token.op === "||")) {
                this.at++
                this.skip_newlines()
                if (this.peek() === undefined) throw new Incomplete(token.op)
                rest.push({ op: token.op, pl: this.pipeline() })
            } else break
        }
        return { first, rest }
    }

    pipeline(): pipeline {
        let neg = false
        if (this.word_is("!")) {
            neg = true
            this.at++
        }
        const cmds = [this.command()]
        while (this.op_is("|")) {
            this.at++
            this.skip_newlines()
            if (this.peek() === undefined) throw new Incomplete("|")
            cmds.push(this.command())
        }
        return { cmds, neg }
    }

    redirs(): redir[] {
        const list: redir[] = []
        for (;;) {
            const token = this.peek()
            if (token?.t !== "redir") return list
            this.at++
            const target = this.peek()
            if (target === undefined) throw new Incomplete("redirection")
            if (target.t !== "word") throw new SyntaxFail("missing redirection target")
            this.at++
            list.push({ fd: token.fd, op: token.op, target: target.raw })
        }
    }

    command(): node {
        const token = this.peek()
        if (token === undefined) throw new Incomplete("command")
        if (token.t === "op" && token.op === "(") {
            this.at++
            const body = this.list(() => this.op_is(")"))
            if (!this.op_is(")")) {
                if (this.peek() === undefined) throw new Incomplete(")")
                throw new SyntaxFail("expected ')'")
            }
            this.at++
            return { t: "group", body, sub: true, redirs: this.redirs() }
        }
        if (token.t === "word") {
            switch (token.raw) {
                case "if": return this.if_command()
                case "while":
                case "until": return this.while_command(token.raw === "until")
                case "for": return this.for_command()
                case "case": return this.case_command()
                case "{": {
                    this.at++
                    const body = this.list(() => this.word_is("}"))
                    this.expect_word("}")
                    return { t: "group", body, sub: false, redirs: this.redirs() }
                }
                case "function": {
                    this.at++
                    const name = this.peek()
                    if (name?.t !== "word") throw new SyntaxFail("function name expected")
                    this.at++
                    if (this.op_is("(")) {
                        this.at++
                        if (!this.op_is(")")) throw new SyntaxFail("expected ')'")
                        this.at++
                    }
                    this.skip_newlines()
                    return { t: "func", name: name.raw, body: this.command() }
                }
            }
            const next = this.tokens[this.at + 1]
            if (next?.t === "op" && next.op === "(" && /^[A-Za-z_][A-Za-z0-9_-]*$/.test(token.raw) && !reserved.has(token.raw)) {
                const close = this.tokens[this.at + 2]
                if (close?.t === "op" && close.op === ")") {
                    this.at += 3
                    this.skip_newlines()
                    if (this.peek() === undefined) throw new Incomplete("function")
                    return { t: "func", name: token.raw, body: this.command() }
                }
            }
            if (reserved.has(token.raw) && token.raw !== "!") throw new SyntaxFail(`unexpected '${token.raw}'`)
        }
        return this.simple()
    }

    simple(): simple {
        const assigns: simple["assigns"] = []
        const words: string[] = []
        const redirs: redir[] = []
        for (;;) {
            const token = this.peek()
            if (token === undefined) break
            if (token.t === "redir") {
                redirs.push(...this.redirs())
                continue
            }
            if (token.t !== "word") break
            if (words.length === 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(token.raw)) {
                const eq = token.raw.indexOf("=")
                assigns.push({ name: token.raw.slice(0, eq), value: token.raw.slice(eq + 1) })
            } else words.push(token.raw)
            this.at++
        }
        if (assigns.length === 0 && words.length === 0 && redirs.length === 0) throw new SyntaxFail(`unexpected '${this.describe()}'`)
        return { t: "simple", assigns, words, redirs }
    }

    if_command(): node {
        this.at++
        const branches: { test: list, body: list }[] = []
        let other: list | null = null
        const ends = (): boolean => this.word_is("then") || this.word_is("elif") || this.word_is("else") || this.word_is("fi")
        for (;;) {
            const test = this.list(() => this.word_is("then"))
            this.expect_word("then")
            const body = this.list(ends)
            branches.push({ test, body })
            this.skip_newlines()
            if (this.word_is("elif")) {
                this.at++
                continue
            }
            if (this.word_is("else")) {
                this.at++
                other = this.list(() => this.word_is("fi"))
            }
            this.expect_word("fi")
            break
        }
        return { t: "if", branches, other, redirs: this.redirs() }
    }

    while_command(until: boolean): node {
        this.at++
        const test = this.list(() => this.word_is("do"))
        this.expect_word("do")
        const body = this.list(() => this.word_is("done"))
        this.expect_word("done")
        return { t: "while", test, body, until, redirs: this.redirs() }
    }

    for_command(): node {
        this.at++
        const name = this.peek()
        if (name?.t !== "word") throw this.peek() === undefined ? new Incomplete("for") : new SyntaxFail("for needs a name")
        this.at++
        let words: string[] | null = null
        this.skip_newlines()
        if (this.word_is("in")) {
            this.at++
            words = []
            for (;;) {
                const token = this.peek()
                if (token?.t === "word") {
                    words.push(token.raw)
                    this.at++
                } else break
            }
        }
        while (this.peek()?.t === "nl" || this.op_is(";")) this.at++
        this.expect_word("do")
        const body = this.list(() => this.word_is("done"))
        this.expect_word("done")
        return { t: "for", name: name.raw, words, body, redirs: this.redirs() }
    }

    case_command(): node {
        this.at++
        const word = this.peek()
        if (word?.t !== "word") throw this.peek() === undefined ? new Incomplete("case") : new SyntaxFail("case needs a word")
        this.at++
        this.skip_newlines()
        this.expect_word("in")
        const items: { patterns: string[], body: list }[] = []
        for (;;) {
            this.skip_newlines()
            if (this.peek() === undefined) throw new Incomplete("esac")
            if (this.word_is("esac")) {
                this.at++
                break
            }
            if (this.op_is("(")) this.at++
            const patterns: string[] = []
            for (;;) {
                const token = this.peek()
                if (token?.t !== "word") throw this.peek() === undefined ? new Incomplete("case") : new SyntaxFail("pattern expected")
                patterns.push(token.raw)
                this.at++
                if (this.op_is("|")) {
                    this.at++
                    continue
                }
                break
            }
            if (!this.op_is(")")) throw this.peek() === undefined ? new Incomplete("case") : new SyntaxFail("expected ')'")
            this.at++
            const body = this.list(() => this.word_is("esac") || this.op_is(";;"))
            items.push({ patterns, body })
            if (this.op_is(";;")) this.at++
        }
        return { t: "case", word: word.raw, items, redirs: this.redirs() }
    }
}

export function parse(src: string): list {
    return new parser(lex(src)).program()
}

// ---- shell state ------------------------------------------------------------------------------------------------------------------

type flow = { kind: "break" | "continue" | "return" | "exit" | "interrupt", n: number }

type shell = {
    proc: proc_api
    vars: Record<string, string>
    exported: Set<string>
    funcs: Map<string, node>
    cwd: string
    params: string[]
    script: string
    last: number
    last_bg: number
    jobs: Promise<number>[]
    // Ctrl+C: set while a command of the shell's own runs; waits are cut short through `cancel`
    interrupted: boolean
    cancel: AbortController
    depth: number
    fn_depth: number
}

type io = { stdin: text_stream, stdout: text_stream, stderr: text_stream }

function is_flow(value: unknown): value is flow {
    return typeof value === "object" && value !== null && "kind" in value && "n" in value
}

function throw_flow(kind: flow["kind"], n: number = 1): never {
    throw { kind, n } satisfies flow
}

function clone_shell(sh: shell): shell {
    return { ...sh, vars: { ...sh.vars }, exported: new Set(sh.exported), funcs: new Map(sh.funcs), jobs: [], depth: sh.depth + 1 }
}

// a loop made only of microtasks would never let the window deliver Ctrl+C: every so often the shell gives the page a turn
let ticks = 0
async function breathe(): Promise<void> {
    if (++ticks % 40 === 0) await new Promise<void>(done => setTimeout(done, 0))
}

function check_interrupt(sh: shell): void {
    if (sh.interrupted) {
        sh.interrupted = false
        throw_flow("interrupt")
    }
}

// ---- arithmetic -------------------------------------------------------------------------------------------------------------------

function arith(source: string, sh: shell): number {
    const tokens = source.match(/[A-Za-z_][A-Za-z0-9_]*|0[xX][0-9a-fA-F]+|\d+|<<|>>|<=|>=|==|!=|&&|\|\||[-+*/%()<>!~&|^?:]/g) ?? []
    let at = 0
    const peek = (): string | undefined => tokens[at]
    const take = (): string => tokens[at++]
    const value_of = (name: string): number => Number.parseInt(sh.vars[name] ?? "0", 10) || 0
    const primary = (): number => {
        const token = take()
        if (token === undefined) throw new Error("arithmetic: unexpected end")
        if (token === "(") {
            const inner = ternary()
            if (take() !== ")") throw new Error("arithmetic: missing )")
            return inner
        }
        if (token === "-") return -unary()
        if (token === "+") return unary()
        if (token === "!") return unary() === 0 ? 1 : 0
        if (token === "~") return ~unary()
        if (/^\d|^0[xX]/.test(token)) return Number(token)
        if (/^[A-Za-z_]/.test(token)) return value_of(token)
        throw new Error(`arithmetic: unexpected '${token}'`)
    }
    const unary = (): number => primary()
    const level = (next: () => number, ops: string[], apply: (op: string, a: number, b: number) => number): (() => number) => () => {
        let left = next()
        while (peek() !== undefined && ops.includes(peek()!)) {
            const op = take()
            left = apply(op, left, next())
        }
        return left
    }
    const mul = level(unary, ["*", "/", "%"], (op, a, b) => {
        if (op !== "*" && b === 0) throw new Error("division by 0")
        return op === "*" ? a * b : op === "/" ? Math.trunc(a / b) : a % b
    })
    const add = level(mul, ["+", "-"], (op, a, b) => (op === "+" ? a + b : a - b))
    const shift = level(add, ["<<", ">>"], (op, a, b) => (op === "<<" ? a << b : a >> b))
    const rel = level(shift, ["<", ">", "<=", ">="], (op, a, b) => Number(op === "<" ? a < b : op === ">" ? a > b : op === "<=" ? a <= b : a >= b))
    const eq = level(rel, ["==", "!="], (op, a, b) => Number(op === "==" ? a === b : a !== b))
    const bit_and = level(eq, ["&"], (_, a, b) => a & b)
    const bit_xor = level(bit_and, ["^"], (_, a, b) => a ^ b)
    const bit_or = level(bit_xor, ["|"], (_, a, b) => a | b)
    const and = level(bit_or, ["&&"], (_, a, b) => Number(a !== 0 && b !== 0))
    const or = level(and, ["||"], (_, a, b) => Number(a !== 0 || b !== 0))
    const ternary = (): number => {
        const test = or()
        if (peek() !== "?") return test
        take()
        const yes = ternary()
        if (take() !== ":") throw new Error("arithmetic: missing :")
        const no = ternary()
        return test !== 0 ? yes : no
    }
    const result = ternary()
    if (at < tokens.length) throw new Error(`arithmetic: unexpected '${tokens[at]}'`)
    return result
}

// ---- expansion --------------------------------------------------------------------------------------------------------------------

// one character of a field being built, and whether quoting protects it from field splitting and globbing
type piece = { c: string, q: boolean }

function glob_to_regex(pattern: string, anchored: boolean = true): RegExp {
    let out = ""
    for (let i = 0; i < pattern.length; i++) {
        const c = pattern[i]
        if (c === "*") out += "[^]*"
        else if (c === "?") out += "[^]"
        else if (c === "[") {
            const end = pattern.indexOf("]", i + 2)
            if (end < 0) out += "\\["
            else {
                let set = pattern.slice(i + 1, end)
                if (set.startsWith("!")) set = "^" + set.slice(1)
                out += `[${set.replace(/\\/g, "\\\\")}]`
                i = end
            }
        } else if (c === "\\" && i + 1 < pattern.length) out += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        else out += c.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")
    }
    return new RegExp(anchored ? `^${out}$` : out)
}

export function glob_match(pattern: string, value: string): boolean {
    return glob_to_regex(pattern).test(value)
}

async function glob_expand(sh: shell, pattern: piece[]): Promise<string[]> {
    const text = pattern.map(item => item.c).join("")
    const absolute_path = text.startsWith("/")
    const segments = split_pieces(pattern)
    let bases: string[] = [absolute_path ? "/" : ""]
    for (let index = 0; index < segments.length; index++) {
        const segment = segments[index]
        const last = index === segments.length - 1
        const next: string[] = []
        const active = segment.some(item => !item.q && "*?[".includes(item.c))
        const plain = segment.map(item => item.c).join("")
        for (const base of bases) {
            const dir = base === "" ? sh.cwd : base
            if (!active) {
                const path = base === "" ? plain : base === "/" ? `/${plain}` : `${base}/${plain}`
                if (plain === "" || (await sh.proc.fs.stat(absolute(sh.cwd, path)))) next.push(path)
                continue
            }
            let names: { name: string, kind: string }[] = []
            try {
                names = await sh.proc.fs.list(dir)
            } catch {
                continue
            }
            // the pattern of this segment, with quoted characters taken literally
            const source = segment.map(item => (item.q && "*?[]\\".includes(item.c) ? "\\" + item.c : item.c)).join("")
            const regex = glob_to_regex(source)
            for (const entry of names) {
                if (entry.name.startsWith(".") && !plain.startsWith(".")) continue
                if (!regex.test(entry.name)) continue
                if (!last && entry.kind !== "dir") continue
                next.push(base === "" ? entry.name : base === "/" ? `/${entry.name}` : `${base}/${entry.name}`)
            }
        }
        bases = next
        if (bases.length === 0) break
    }
    return bases.sort()
}

function split_pieces(pattern: piece[]): piece[][] {
    const segments: piece[][] = [[]]
    for (const item of pattern) {
        if (item.c === "/" && !item.q) segments.push([])
        else segments[segments.length - 1].push(item)
    }
    if (segments[0].length === 0 && segments.length > 1) segments.shift()
    return segments.filter((segment, index) => segment.length > 0 || index === segments.length - 1)
}

type field_builder = { fields: piece[][], current: piece[], present: boolean }

function builder(): field_builder {
    return { fields: [], current: [], present: false }
}

function push_text(target: field_builder, text: string, quoted: boolean): void {
    for (const c of text) target.current.push({ c, q: quoted })
    if (quoted) target.present = true
}

// text from an unquoted expansion is split at whitespace
function push_split(target: field_builder, text: string): void {
    for (const c of text) {
        if (c === " " || c === "\t" || c === "\n") {
            if (target.current.length > 0 || target.present) {
                target.fields.push(target.current)
                target.current = []
                target.present = false
            }
        } else target.current.push({ c, q: false })
    }
}

function cut_field(target: field_builder): void {
    target.fields.push(target.current)
    target.current = []
    target.present = false
}

async function run_substitution(sh: shell, source: string): Promise<string> {
    const text: string[] = []
    const capture = sh.proc.pipe()
    const reader = (async () => {
        for (;;) {
            const chunk = await capture.read()
            if (chunk === null) break
            text.push(chunk)
        }
    })()
    const sub = clone_shell(sh)
    try {
        sh.last = await run_source(sub, source, { stdin: sh.proc.stdin, stdout: capture, stderr: sh.proc.stderr })
    } catch (error) {
        if (!is_flow(error)) throw error
        sh.last = error.n
    }
    capture.end()
    await reader
    return text.join("").replace(/\n+$/, "")
}

function remove_pattern(value: string, pattern: string, from_start: boolean, longest: boolean): string {
    const regex = glob_to_regex(pattern)
    if (from_start) {
        const range = longest ? [...Array(value.length + 1).keys()].reverse() : [...Array(value.length + 1).keys()]
        for (const end of range) if (regex.test(value.slice(0, end))) return value.slice(end)
    } else {
        const range = longest ? [...Array(value.length + 1).keys()] : [...Array(value.length + 1).keys()].reverse()
        for (const start of range) if (regex.test(value.slice(start))) return value.slice(0, start)
    }
    return value
}

function lookup(sh: shell, name: string): string | undefined {
    if (name === "?") return String(sh.last)
    if (name === "$") return String(sh.proc.pid)
    if (name === "#") return String(sh.params.length)
    if (name === "!") return sh.last_bg ? String(sh.last_bg) : ""
    if (name === "0") return sh.script
    if (/^[1-9][0-9]*$/.test(name)) return sh.params[Number(name) - 1]
    if (name === "*" || name === "@") return sh.params.join(" ")
    if (name === "RANDOM") return String(Math.floor(Math.random() * 32768))
    return sh.vars[name]
}

// ${name...}: the part between the braces
async function expand_braced(sh: shell, body: string, quoted: boolean): Promise<string> {
    if (body.startsWith("#") && body.length > 1) return String((lookup(sh, body.slice(1)) ?? "").length)
    const match = /^([A-Za-z_][A-Za-z0-9_]*|[0-9]+|[?$#!@*])(.*)$/s.exec(body)
    if (!match) throw new Error(`bad substitution: \${${body}}`)
    const [, name, rest] = match
    const value = lookup(sh, name)
    if (rest === "") return value ?? ""
    const word = async (text: string): Promise<string> => (await expand_word(sh, text, quoted)).join(" ")
    const operator = /^(:?[-=+?]|##|#|%%|%|\/\/|\/)(.*)$/s.exec(rest)
    if (!operator) throw new Error(`bad substitution: \${${body}}`)
    const [, op, arg] = operator
    const unset = value === undefined || (op.startsWith(":") && value === "")
    switch (op.replace(":", "")) {
        case "-": return unset ? await word(arg) : value!
        case "+": return unset ? "" : await word(arg)
        case "=": {
            if (!unset) return value!
            const fresh = await word(arg)
            sh.vars[name] = fresh
            return fresh
        }
        case "?": {
            if (!unset) return value!
            throw new Error(`${name}: ${arg || "parameter not set"}`)
        }
        case "#": return remove_pattern(value ?? "", await word(arg), true, false)
        case "##": return remove_pattern(value ?? "", await word(arg), true, true)
        case "%": return remove_pattern(value ?? "", await word(arg), false, false)
        case "%%": return remove_pattern(value ?? "", await word(arg), false, true)
        case "/":
        case "//": {
            const slash = arg.indexOf("/")
            const pattern = slash < 0 ? arg : arg.slice(0, slash)
            const replacement = slash < 0 ? "" : arg.slice(slash + 1)
            const regex = glob_to_regex(await word(pattern), false)
            return (value ?? "").replace(new RegExp(regex.source, op === "//" ? "g" : ""), await word(replacement))
        }
    }
    return value ?? ""
}

// expands one raw word into fields (quotes removed, variables and commands substituted, split and globbed)
export async function expand_word(sh: shell, raw: string, quoted_context: boolean = false, glob: boolean = false): Promise<string[]> {
    const out = builder()
    let i = 0
    // a leading ~ is the home folder
    if (!quoted_context && raw.startsWith("~") && (raw.length === 1 || raw[1] === "/")) {
        push_text(out, sh.vars.HOME ?? "/", true)
        i = 1
    }
    const handle_dollar = async (quoted: boolean): Promise<void> => {
        const next = raw[i + 1]
        if (next === "(" && raw[i + 2] === "(") {
            const end = scan_part(raw, i)
            const inner = raw.slice(i + 3, end - 2)
            const value = String(arith(await expand_string(sh, inner), sh))
            if (quoted) push_text(out, value, true)
            else push_split(out, value)
            i = end
        } else if (next === "(") {
            const end = scan_part(raw, i)
            const value = await run_substitution(sh, raw.slice(i + 2, end - 1))
            if (quoted) push_text(out, value, true)
            else push_split(out, value)
            i = end
        } else if (next === "{") {
            const end = scan_part(raw, i)
            const value = await expand_braced(sh, raw.slice(i + 2, end - 1), quoted)
            if (quoted) push_text(out, value, true)
            else push_split(out, value)
            i = end
        } else if (next === "@" && quoted) {
            sh.params.forEach((param, index) => {
                if (index > 0) cut_field(out)
                push_text(out, param, true)
            })
            if (sh.params.length === 0) out.present = out.present || false
            i += 2
        } else if (next !== undefined && /[A-Za-z_]/.test(next)) {
            let end = i + 1
            while (end < raw.length && /[A-Za-z0-9_]/.test(raw[end])) end++
            const value = lookup(sh, raw.slice(i + 1, end)) ?? ""
            if (quoted) push_text(out, value, true)
            else push_split(out, value)
            i = end
        } else if (next !== undefined && /[0-9?$#!@*]/.test(next)) {
            const value = lookup(sh, next) ?? ""
            if (quoted) push_text(out, value, true)
            else push_split(out, value)
            i += 2
        } else {
            push_text(out, "$", true)
            i++
        }
    }
    while (i < raw.length) {
        const ch = raw[i]
        if (ch === "\\") {
            if (i + 1 < raw.length) push_text(out, raw[i + 1], true)
            i += 2
        } else if (ch === "'") {
            const end = raw.indexOf("'", i + 1)
            push_text(out, raw.slice(i + 1, end), true)
            out.present = true
            i = end + 1
        } else if (ch === '"') {
            out.present = true
            i++
            while (raw[i] !== '"') {
                if (raw[i] === "\\" && '$`"\\\n'.includes(raw[i + 1])) {
                    if (raw[i + 1] !== "\n") push_text(out, raw[i + 1], true)
                    i += 2
                } else if (raw[i] === "$") await handle_dollar(true)
                else if (raw[i] === "`") {
                    const end = scan_part(raw, i)
                    push_text(out, await run_substitution(sh, raw.slice(i + 1, end - 1)), true)
                    i = end
                } else push_text(out, raw[i++], true)
            }
            i++
        } else if (ch === "`") {
            const end = scan_part(raw, i)
            push_split(out, await run_substitution(sh, raw.slice(i + 1, end - 1)))
            i = end
        } else if (ch === "$") await handle_dollar(false)
        else push_text(out, raw[i++], false)
    }
    if (out.current.length > 0 || out.present) cut_field(out)
    const result: string[] = []
    for (const field of out.fields) {
        if (glob && field.some(item => !item.q && "*?[".includes(item.c))) {
            const found = await glob_expand(sh, field)
            if (found.length > 0) {
                result.push(...found)
                continue
            }
        }
        result.push(field.map(item => item.c).join(""))
    }
    return result
}

// a word that is never split or globbed (an assignment's value, a redirection target, a case word)
export async function expand_string(sh: shell, raw: string): Promise<string> {
    return (await expand_word(sh, `"${raw.replace(/\\(?=\n)/g, "").replace(/(?<!\\)"/g, '\\"')}"`)).join(" ")
}

async function expand_value(sh: shell, raw: string): Promise<string> {
    // a value is not split or globbed, but a leading ~ is still the home folder
    if (raw === "~" || raw.startsWith("~/")) raw = `'${(sh.vars.HOME ?? "/").replace(/'/g, "'\\''")}'` + raw.slice(1)
    const fields = await expand_word(sh, raw, true)
    return fields.join(" ")
}

// ---- running ----------------------------------------------------------------------------------------------------------------------

function file_writer(sh: shell, path: string, append: boolean): { stream: text_stream, close: () => Promise<void> } {
    const chunks: string[] = []
    const stream: text_stream = {
        ended: false,
        write(data) { chunks.push(data) },
        end() { stream.ended = true },
        eof() {},
        read: () => Promise.resolve(null),
    }
    return { stream, close: async () => { await sh.proc.fs.write(path, chunks.join(""), append) } }
}

async function read_stream(stream: text_stream): Promise<string> {
    const parts: string[] = []
    for (;;) {
        const chunk = await stream.read()
        if (chunk === null) break
        parts.push(chunk)
    }
    return parts.join("")
}

function text_input(text: string, sh: shell): text_stream {
    const stream = sh.proc.pipe()
    stream.write(text)
    stream.end()
    return stream
}

// applies the redirections of a command to the streams it will run with; `close` finishes the files that were written
async function apply_redirs(sh: shell, redirs: redir[], base: io): Promise<{ io: io, close: () => Promise<void> }> {
    const streams: Record<number, text_stream> = { 0: base.stdin, 1: base.stdout, 2: base.stderr }
    const closers: (() => Promise<void>)[] = []
    for (const redir of redirs) {
        const target = await expand_value(sh, redir.target)
        if (redir.op === ">&" || redir.op === "<&") {
            if (target === "-") continue
            if (!/^[0-9]$/.test(target) || !streams[Number(target)]) throw new Error(`${target}: bad file descriptor`)
            streams[redir.fd] = streams[Number(target)]
            continue
        }
        const path = absolute(sh.cwd, target)
        if (redir.op === "<") {
            const info = await sh.proc.fs.stat(path)
            if (!info) throw new Error(`${target}: No such file or directory`)
            if (info.kind === "dir") throw new Error(`${target}: Is a directory`)
            streams[redir.fd] = text_input(await sh.proc.fs.read(path), sh)
            continue
        }
        if (path === "/dev/null") {
            streams[redir.fd] = { ended: false, write() {}, end() {}, eof() {}, read: () => Promise.resolve(null) }
            continue
        }
        const info = await sh.proc.fs.stat(path)
        if (info?.kind === "dir") throw new Error(`${target}: Is a directory`)
        // > creates (or empties) the file before the command runs, so a failed command still leaves it
        if (redir.op === ">") await sh.proc.fs.write(path, "", false)
        const writer = file_writer(sh, path, true)
        streams[redir.fd] = writer.stream
        closers.push(writer.close)
    }
    return { io: { stdin: streams[0], stdout: streams[1], stderr: streams[2] }, close: async () => { for (const close of closers) await close() } }
}

const inline_programs = new Set(["echo", "printf", "pwd", "true", "false", "test", "[", ":"])

async function run_program(sh: shell, argv: string[], env: Record<string, string>, io: io): Promise<number> {
    const name = argv[0]
    const programs = programs_of(sh)
    if (name.includes("/")) {
        const path = absolute(sh.cwd, name)
        const info = await sh.proc.fs.stat(path)
        if (!info) {
            io.stderr.write(`sh: ${name}: No such file or directory\n`)
            return 127
        }
        if (info.kind === "dir") {
            io.stderr.write(`sh: ${name}: Is a directory\n`)
            return 126
        }
        const base = path.startsWith("/bin/") ? base_name(path) : ""
        if (base && programs[base]) return run_program(sh, [base, ...argv.slice(1)], env, io)
        const child = sh.proc.spawn(["sh", path, ...argv.slice(1)], { cwd: sh.cwd, env, ...io })
        return child.done
    }
    if (inline_programs.has(name) && programs[name]) {
        // no process of its own: these are the commands a shell has inside it
        const api: proc_api = { ...sh.proc, argv, cwd: sh.cwd, env, ...io }
        return programs[name](api)
    }
    if (!programs[name]) {
        io.stderr.write(`sh: ${name}: command not found\n`)
        return 127
    }
    const child = sh.proc.spawn(argv, { cwd: sh.cwd, env, ...io })
    return child.done
}

function programs_of(sh: shell): Record<string, program> {
    return (sh as shell & { programs?: Record<string, program> }).programs ?? runtime_programs
}

let runtime_programs: Record<string, program> = {}

export function set_programs(programs: Record<string, program>): void {
    runtime_programs = programs
}

function exported_env(sh: shell, extra: Record<string, string> = {}): Record<string, string> {
    const env: Record<string, string> = {}
    for (const name of sh.exported) if (sh.vars[name] !== undefined) env[name] = sh.vars[name]
    env.PWD = sh.cwd
    return { ...env, ...extra }
}

async function exec_simple(sh: shell, node: simple, io: io): Promise<number> {
    check_interrupt(sh)
    const argv: string[] = []
    for (const word of node.words) argv.push(...(await expand_word(sh, word, false, true)))
    const assigned: Record<string, string> = {}
    for (const assign of node.assigns) assigned[assign.name] = await expand_value(sh, assign.value)
    let redirected: { io: io, close: () => Promise<void> }
    try {
        redirected = await apply_redirs(sh, node.redirs, io)
    } catch (error) {
        io.stderr.write(`sh: ${error instanceof Error ? error.message : String(error)}\n`)
        return 1
    }
    const run = redirected.io
    try {
        if (argv.length === 0) {
            // plain assignments set shell variables
            for (const [name, value] of Object.entries(assigned)) sh.vars[name] = value
            return 0
        }
        // VAR=x cmd: the assignment is only for that command
        const saved: Record<string, string | undefined> = {}
        const temp_env: Record<string, string> = {}
        for (const [name, value] of Object.entries(assigned)) {
            saved[name] = sh.vars[name]
            temp_env[name] = value
        }
        const name = argv[0]
        if (name in builtins) {
            for (const [key, value] of Object.entries(assigned)) sh.vars[key] = value
            try {
                return await builtins[name](sh, argv.slice(1), run)
            } finally {
                for (const key of Object.keys(assigned)) {
                    if (saved[key] === undefined) delete sh.vars[key]
                    else sh.vars[key] = saved[key]!
                }
            }
        }
        const fn = sh.funcs.get(name)
        if (fn) return await call_function(sh, fn, argv.slice(1), run)
        return await run_program(sh, argv, exported_env(sh, temp_env), run)
    } catch (error) {
        if (is_flow(error)) throw error
        run.stderr.write(`sh: ${error instanceof Error ? error.message : String(error)}\n`)
        return 1
    } finally {
        await redirected.close()
    }
}

async function call_function(sh: shell, fn: node, args: string[], io: io): Promise<number> {
    const saved = sh.params
    sh.params = args
    sh.fn_depth++
    if (sh.fn_depth > 200) {
        sh.fn_depth--
        sh.params = saved
        io.stderr.write("sh: function nesting too deep\n")
        return 1
    }
    try {
        return await exec_node(sh, fn, io)
    } catch (error) {
        if (is_flow(error) && error.kind === "return") return error.n
        throw error
    } finally {
        sh.fn_depth--
        sh.params = saved
    }
}

async function exec_node(sh: shell, node: node, io: io): Promise<number> {
    check_interrupt(sh)
    if (node.t === "simple") return exec_simple(sh, node, io)
    if (node.t === "func") {
        sh.funcs.set(node.name, node.body)
        return 0
    }
    let redirected: { io: io, close: () => Promise<void> }
    try {
        redirected = await apply_redirs(sh, node.redirs, io)
    } catch (error) {
        io.stderr.write(`sh: ${error instanceof Error ? error.message : String(error)}\n`)
        return 1
    }
    const run = redirected.io
    try {
        switch (node.t) {
            case "group": {
                if (!node.sub) return await exec_list(sh, node.body, run)
                const sub = clone_shell(sh)
                try {
                    return await exec_list(sub, node.body, run)
                } catch (error) {
                    if (is_flow(error) && error.kind === "exit") return error.n
                    throw error
                }
            }
            case "if": {
                for (const branch of node.branches) {
                    if ((await exec_list(sh, branch.test, run)) === 0) return await exec_list(sh, branch.body, run)
                }
                return node.other ? await exec_list(sh, node.other, run) : 0
            }
            case "while": {
                let code = 0
                for (;;) {
                    check_interrupt(sh)
                    await breathe()
                    const test = await exec_list(sh, node.test, run)
                    if ((test === 0) === node.until) break
                    try {
                        code = await exec_list(sh, node.body, run)
                    } catch (error) {
                        if (is_flow(error) && (error.kind === "break" || error.kind === "continue")) {
                            if (error.n > 1) throw { kind: error.kind, n: error.n - 1 } satisfies flow
                            if (error.kind === "break") break
                            continue
                        }
                        throw error
                    }
                }
                return code
            }
            case "for": {
                const items: string[] = []
                if (node.words === null) items.push(...sh.params)
                else for (const word of node.words) items.push(...(await expand_word(sh, word, false, true)))
                let code = 0
                for (const item of items) {
                    check_interrupt(sh)
                    await breathe()
                    sh.vars[node.name] = item
                    try {
                        code = await exec_list(sh, node.body, run)
                    } catch (error) {
                        if (is_flow(error) && (error.kind === "break" || error.kind === "continue")) {
                            if (error.n > 1) throw { kind: error.kind, n: error.n - 1 } satisfies flow
                            if (error.kind === "break") break
                            continue
                        }
                        throw error
                    }
                }
                return code
            }
            case "case": {
                const word = await expand_string(sh, node.word)
                for (const item of node.items) {
                    for (const pattern of item.patterns) {
                        if (glob_match(await expand_string(sh, pattern), word)) return await exec_list(sh, item.body, run)
                    }
                }
                return 0
            }
        }
    } finally {
        await redirected.close()
    }
}

async function exec_pipeline(sh: shell, pl: pipeline, io: io): Promise<number> {
    let code: number
    if (pl.cmds.length === 1) code = await exec_node(sh, pl.cmds[0], io)
    else {
        const stages: Promise<number>[] = []
        let input = io.stdin
        pl.cmds.forEach((cmd, index) => {
            const last = index === pl.cmds.length - 1
            const output = last ? io.stdout : sh.proc.pipe()
            // when a stage is done nobody reads its input any more: ending that pipe tells the writer to stop (like SIGPIPE)
            const reads = index > 0 ? input : null
            const stage_io: io = { stdin: input, stdout: output, stderr: io.stderr }
            // each stage is its own subshell, so what it assigns does not leak
            const sub = clone_shell(sh)
            stages.push((async () => {
                try {
                    return await exec_node(sub, cmd, stage_io)
                } catch (error) {
                    if (is_flow(error) && error.kind === "exit") return error.n
                    if (is_flow(error) && error.kind === "interrupt") return 130
                    throw error
                } finally {
                    if (!last) output.end()
                    reads?.end()
                }
            })())
            input = output
        })
        const codes = await Promise.all(stages)
        code = codes[codes.length - 1]
    }
    return pl.neg ? Number(code === 0) : code
}

async function exec_and_or(sh: shell, chain: and_or, io: io): Promise<number> {
    let code = await exec_pipeline(sh, chain.first, io)
    sh.last = code
    for (const part of chain.rest) {
        if ((part.op === "&&") !== (code === 0)) continue
        code = await exec_pipeline(sh, part.pl, io)
        sh.last = code
    }
    return code
}

async function exec_list(sh: shell, body: list, io: io): Promise<number> {
    let code = 0
    for (const item of body.items) {
        check_interrupt(sh)
        if (item.bg) {
            const sub = clone_shell(sh)
            const quiet: io = { stdin: text_input("", sh), stdout: io.stdout, stderr: io.stderr }
            const job = exec_and_or(sub, item.chain, quiet).catch(() => 1)
            sh.jobs.push(job)
            sh.last_bg = sh.proc.pid
            code = 0
        } else code = await exec_and_or(sh, item.chain, io)
        sh.last = code
    }
    return code
}

// runs shell source text to the end; the exit code is that of the last command
export async function run_source(sh: shell, source: string, io: io): Promise<number> {
    let tree: list
    try {
        tree = parse(source)
    } catch (error) {
        if (error instanceof Incomplete) io.stderr.write(`sh: syntax error: unexpected end of file (${error.message})\n`)
        else if (error instanceof SyntaxFail) io.stderr.write(`sh: syntax error: ${error.message}\n`)
        else throw error
        return 2
    }
    return exec_list(sh, tree, io)
}

// ---- builtins ---------------------------------------------------------------------------------------------------------------------

type builtin = (sh: shell, args: string[], io: io) => Promise<number>

async function read_line(sh: shell, stream: text_stream, buffers: WeakMap<text_stream, string>): Promise<string | null> {
    for (;;) {
        const pending = buffers.get(stream) ?? ""
        const at = pending.indexOf("\n")
        if (at >= 0) {
            buffers.set(stream, pending.slice(at + 1))
            return pending.slice(0, at)
        }
        const cancelled = new Promise<null>(done => sh.cancel.signal.addEventListener("abort", () => done(null), { once: true }))
        const chunk = await Promise.race([stream.read(), cancelled])
        if (sh.cancel.signal.aborted) throw_flow("interrupt")
        if (chunk === null) {
            buffers.delete(stream)
            return pending === "" ? null : pending
        }
        buffers.set(stream, pending + chunk)
    }
}

const line_buffers = new WeakMap<text_stream, string>()

const builtins: Record<string, builtin> = {
    async cd(sh, args, io) {
        let target = args[0] ?? sh.vars.HOME ?? "/"
        if (target === "-") target = sh.vars.OLDPWD ?? sh.cwd
        if (target === "~" || target.startsWith("~/")) target = (sh.vars.HOME ?? "/") + target.slice(1)
        const path = absolute(sh.cwd, target)
        const info = await sh.proc.fs.stat(path)
        if (!info) {
            io.stderr.write(`cd: ${args[0] ?? target}: No such file or directory\n`)
            return 1
        }
        if (info.kind !== "dir") {
            io.stderr.write(`cd: ${args[0] ?? target}: Not a directory\n`)
            return 1
        }
        sh.vars.OLDPWD = sh.cwd
        sh.cwd = path
        sh.vars.PWD = path
        return 0
    },
    async export(sh, args, io) {
        if (args.length === 0) {
            for (const name of [...sh.exported].sort()) io.stdout.write(`export ${name}="${sh.vars[name] ?? ""}"\n`)
            return 0
        }
        for (const arg of args) {
            const eq = arg.indexOf("=")
            const name = eq < 0 ? arg : arg.slice(0, eq)
            if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
                io.stderr.write(`export: '${arg}': not a valid identifier\n`)
                return 1
            }
            if (eq >= 0) sh.vars[name] = arg.slice(eq + 1)
            sh.exported.add(name)
        }
        return 0
    },
    async unset(sh, args) {
        for (const name of args) {
            delete sh.vars[name]
            sh.exported.delete(name)
            sh.funcs.delete(name)
        }
        return 0
    },
    async set(sh, args, io) {
        if (args.length === 0) {
            for (const name of Object.keys(sh.vars).sort()) io.stdout.write(`${name}='${sh.vars[name]}'\n`)
            return 0
        }
        if (args[0] === "--") sh.params = args.slice(1)
        return 0
    },
    async shift(sh, args) {
        sh.params = sh.params.slice(Number(args[0] ?? 1) || 1)
        return 0
    },
    async exit(sh, args) {
        throw_flow("exit", args[0] === undefined ? sh.last : Number(args[0]) & 255)
    },
    async return(sh, args) {
        throw_flow("return", args[0] === undefined ? sh.last : Number(args[0]) & 255)
    },
    async break(_sh, args) {
        throw_flow("break", Number(args[0] ?? 1) || 1)
    },
    async continue(_sh, args) {
        throw_flow("continue", Number(args[0] ?? 1) || 1)
    },
    async read(sh, args, io) {
        const names = args.filter(arg => !arg.startsWith("-"))
        if (names.length === 0) names.push("REPLY")
        const prompt = args.indexOf("-p")
        if (prompt >= 0 && args[prompt + 1] !== undefined) {
            io.stderr.write(args[prompt + 1])
            names.splice(names.indexOf(args[prompt + 1]), 1)
        }
        const line = await read_line(sh, io.stdin, line_buffers)
        if (line === null) {
            for (const name of names) sh.vars[name] = ""
            return 1
        }
        const parts = line.split(/[ \t]+/).filter((part, index) => part !== "" || index > 0)
        names.forEach((name, index) => {
            sh.vars[name] = index === names.length - 1 ? line.trim().split(/[ \t]+/).slice(index).join(" ") : (parts[index] ?? "")
        })
        return 0
    },
    async source(sh, args, io) {
        if (!args[0]) {
            io.stderr.write("source: filename argument required\n")
            return 2
        }
        const path = absolute(sh.cwd, args[0])
        let text: string
        try {
            text = await sh.proc.fs.read(path)
        } catch {
            io.stderr.write(`source: ${args[0]}: No such file or directory\n`)
            return 1
        }
        const saved = sh.params
        if (args.length > 1) sh.params = args.slice(1)
        try {
            return await run_source(sh, text, io)
        } finally {
            sh.params = saved
        }
    },
    async eval(sh, args, io) {
        return run_source(sh, args.join(" "), io)
    },
    async wait(sh) {
        const jobs = sh.jobs.splice(0)
        const codes = await Promise.all(jobs)
        return codes[codes.length - 1] ?? 0
    },
    async local(sh, args) {
        for (const arg of args) {
            const eq = arg.indexOf("=")
            if (eq >= 0) sh.vars[arg.slice(0, eq)] = arg.slice(eq + 1)
        }
        return 0
    },
    async trap() {
        return 0
    },
    async type(sh, args, io) {
        let code = 0
        for (const name of args) {
            if (name in builtins) io.stdout.write(`${name} is a shell builtin\n`)
            else if (sh.funcs.has(name)) io.stdout.write(`${name} is a function\n`)
            else if (programs_of(sh)[name]) io.stdout.write(`${name} is /bin/${name}\n`)
            else {
                io.stderr.write(`type: ${name}: not found\n`)
                code = 1
            }
        }
        return code
    },
    async command(sh, args, io) {
        if (args[0] === "-v") {
            const name = args[1]
            if (name && (name in builtins || programs_of(sh)[name])) {
                io.stdout.write(`${name in builtins ? name : `/bin/${name}`}\n`)
                return 0
            }
            return 1
        }
        const argv = args
        if (argv.length === 0) return 0
        if (argv[0] in builtins) return builtins[argv[0]](sh, argv.slice(1), io)
        return run_program(sh, argv, exported_env(sh), io)
    },
    async exec(sh, args, io) {
        if (args.length === 0) return 0
        const code = await run_program(sh, args, exported_env(sh), io)
        throw_flow("exit", code)
    },
    async help(sh, _args, io) {
        io.stdout.write(`Built in: ${Object.keys(builtins).sort().join(" ")}\n\nPrograms: ${Object.keys(programs_of(sh)).sort().join(" ")}\n`)
        return 0
    },
}

// ---- the sh program --------------------------------------------------------------------------------------------------------------

function prompt_of(sh: shell, text: string): string {
    const home = sh.vars.HOME ?? "/"
    const here = sh.cwd === home ? "~" : sh.cwd.startsWith(home + "/") && home !== "/" ? "~" + sh.cwd.slice(home.length) : sh.cwd
    return text.replace(/\\([uwWp$\\n])/g, (_, code: string) =>
        code === "u" ? (sh.vars.USER ?? "user") : code === "w" ? here : code === "W" ? base_name(here) : code === "p" ? String(sh.proc.pid) : code === "$" ? "$" : code === "n" ? "\n" : "\\")
}

function make_shell(p: proc_api, script: string, params: string[]): shell {
    const vars: Record<string, string> = {
        HOME: "/home/user", USER: "user", SHELL: "/bin/sh", PATH: "/bin", TERM: "jazu", LANG: "en_US.UTF-8", IFS: " \t\n", PS1: "\\u@pid\\p:\\w\\$ ", PS2: "> ",
        ...p.env,
    }
    const cwd = p.cwd === "/" && !p.env.PWD ? (vars.HOME ?? "/") : p.cwd
    const exported = new Set(Object.keys(p.env).concat(["HOME", "USER", "SHELL", "PATH", "TERM", "LANG"]))
    return {
        proc: p, vars, exported, funcs: new Map(), cwd, params, script, last: 0, last_bg: 0, jobs: [], interrupted: false, cancel: new AbortController(),
        depth: 0, fn_depth: 0,
    }
}

async function interactive_loop(sh: shell, io: io): Promise<number> {
    const buffers = new WeakMap<text_stream, string>()
    let idle = false
    sh.proc.on_interrupt(() => {
        if (idle) {
            // nothing runs: the line being typed is dropped by the window, the shell asks again
            io.stdout.write(`\n${prompt_of(sh, sh.vars.PS1)}`)
            return
        }
        sh.interrupted = true
        sh.cancel.abort()
    })
    let source = ""
    for (;;) {
        const prompt = source === "" ? prompt_of(sh, sh.vars.PS1) : prompt_of(sh, sh.vars.PS2)
        io.stdout.write(prompt)
        idle = true
        let line: string | null
        try {
            line = await read_line(sh, io.stdin, buffers)
        } catch (error) {
            if (is_flow(error)) {
                sh.cancel = new AbortController()
                source = ""
                continue
            }
            throw error
        } finally {
            idle = false
        }
        if (line === null) {
            io.stdout.write(source === "" ? "exit\n" : "\n")
            return sh.last
        }
        source += (source === "" ? "" : "\n") + line
        let tree: list
        try {
            tree = parse(source)
        } catch (error) {
            if (error instanceof Incomplete) continue
            io.stderr.write(`sh: syntax error: ${error instanceof SyntaxFail ? error.message : String(error)}\n`)
            sh.last = 2
            source = ""
            continue
        }
        source = ""
        sh.interrupted = false
        sh.cancel = new AbortController()
        try {
            sh.last = await exec_list(sh, tree, io)
        } catch (error) {
            if (is_flow(error)) {
                if (error.kind === "exit") return error.n
                if (error.kind === "interrupt") sh.last = 130
            } else io.stderr.write(`sh: ${error instanceof Error ? error.message : String(error)}\n`)
        }
        // a command that ended on Ctrl+C leaves the cursor on its line
        if (sh.last === 130) io.stdout.write("\n")
        sh.jobs = sh.jobs.filter(() => false)
    }
}

export const sh_program: program = async p => {
    const args = p.argv.slice(1)
    const io: io = { stdin: p.stdin, stdout: p.stdout, stderr: p.stderr }
    let script = "sh"
    let params: string[] = []
    let source: string | null = null
    let from_file: string | null = null
    for (let i = 0; i < args.length; i++) {
        if (args[i] === "-c") {
            source = args[i + 1] ?? ""
            params = args.slice(i + 2)
            if (params.length > 0) {
                script = params[0]
                params = params.slice(1)
            }
            break
        }
        if (args[i] === "-s" || args[i] === "-i") continue
        from_file = args[i]
        params = args.slice(i + 1)
        break
    }
    const sh = make_shell(p, script, params)
    try {
        if (from_file !== null) {
            const path = absolute(sh.cwd, from_file)
            let text: string
            try {
                text = await p.fs.read(path)
            } catch {
                p.stderr.write(`sh: ${from_file}: No such file or directory\n`)
                return 127
            }
            sh.script = from_file
            return await run_source(sh, text.replace(/^#![^\n]*\n/, "\n"), io)
        }
        if (source !== null) return await run_source(sh, source, io)
        if (p.interactive) return await interactive_loop(sh, io)
        return await run_source(sh, await read_stream(p.stdin), io)
    } catch (error) {
        if (is_flow(error)) return error.n
        throw error
    } finally {
        await Promise.allSettled(sh.jobs)
    }
}

export type { fs_api }
