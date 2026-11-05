// awk: a compact interpreter for the common language: BEGIN / END / pattern { action } rules, fields, NF NR FS OFS ORS FILENAME, variables and
// arrays, user functions, if / while / do / for / for-in, print / printf, getline is not supported.

import type { proc_api, program } from "./proc_types.ts"
import { absolute } from "./desk_sh.ts"
import { make_regex } from "./desk_regex.ts"
import { format_printf } from "./desk_printf.ts"

// a value from input that looks like a number compares as one
class strnum { constructor(public s: string) {} }
type val = number | string | strnum

type tok = { t: "num" | "str" | "re" | "name" | "func" | "kw" | "op" | "nl" | "eof", v: string }

const keywords = new Set(["BEGIN", "END", "function", "if", "else", "while", "for", "do", "in", "return", "next", "exit", "print", "printf", "delete", "break", "continue", "getline"])

function lex_awk(src: string): tok[] {
    const out: tok[] = []
    let i = 0
    const operand_before = (): boolean => {
        const last = out[out.length - 1]
        return !last || last.t === "op" && !")]".includes(last.v) && !["++", "--"].includes(last.v) || last.t === "nl" || last.t === "kw" && last.v !== "getline"
    }
    while (i < src.length) {
        const c = src[i]
        if (c === " " || c === "\t" || c === "\r") i++
        else if (c === "\\" && src[i + 1] === "\n") i += 2
        else if (c === "\n") { out.push({ t: "nl", v: "\n" }); i++ }
        else if (c === "#") { while (i < src.length && src[i] !== "\n") i++ }
        else if (c === '"') {
            let s = ""
            i++
            while (i < src.length && src[i] !== '"') {
                if (src[i] === "\\") {
                    const n = src[++i]
                    s += n === "n" ? "\n" : n === "t" ? "\t" : n === "r" ? "\r" : n === "\\" ? "\\" : n === '"' ? '"' : n === "/" ? "/" : "\\" + n
                } else s += src[i]
                i++
            }
            out.push({ t: "str", v: s })
            i++
        } else if (c === "/" && operand_before()) {
            let s = ""
            i++
            while (i < src.length && src[i] !== "/") {
                if (src[i] === "\\" && src[i + 1] === "/") { s += "/"; i += 2 } else if (src[i] === "[") {
                    while (i < src.length && src[i] !== "]") s += src[i++]
                    s += src[i++] ?? ""
                } else s += src[i++]
            }
            i++
            out.push({ t: "re", v: s })
        } else if (/[0-9.]/.test(c) && !(c === "." && !/[0-9]/.test(src[i + 1] ?? ""))) {
            const m = /^(?:0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/.exec(src.slice(i))!
            out.push({ t: "num", v: m[0] })
            i += m[0].length
        } else if (/[A-Za-z_]/.test(c)) {
            const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!
            i += m[0].length
            out.push({ t: keywords.has(m[0]) ? "kw" : src[i] === "(" ? "func" : "name", v: m[0] })
        } else {
            const three = src.slice(i, i + 3)
            const two = src.slice(i, i + 2)
            const op = three === "**=" ? three : ["&&", "||", "==", "!=", "<=", ">=", "++", "--", "+=", "-=", "*=", "/=", "%=", "^=", "!~", "**", ">>"].includes(two) ? two : c
            out.push({ t: "op", v: op === "**" ? "^" : op })
            i += op.length
        }
    }
    out.push({ t: "eof", v: "" })
    return out
}

type expr =
    | { k: "num", v: number } | { k: "str", v: string } | { k: "re", v: string }
    | { k: "var", name: string } | { k: "index", name: string, subs: expr[] } | { k: "field", e: expr }
    | { k: "assign", op: string, to: expr, e: expr } | { k: "cond", c: expr, a: expr, b: expr }
    | { k: "bin", op: string, a: expr, b: expr } | { k: "un", op: string, e: expr } | { k: "incr", op: string, pre: boolean, to: expr }
    | { k: "call", name: string, args: expr[] } | { k: "in", subs: expr[], name: string } | { k: "group", e: expr }
type stmt =
    | { s: "expr", e: expr } | { s: "print", args: expr[], parens: boolean } | { s: "printf", args: expr[] } | { s: "block", body: stmt[] }
    | { s: "if", c: expr, a: stmt, b: stmt | null } | { s: "while", c: expr, body: stmt } | { s: "do", c: expr, body: stmt }
    | { s: "for", init: stmt | null, c: expr | null, step: stmt | null, body: stmt } | { s: "forin", v: string, arr: string, body: stmt }
    | { s: "next" } | { s: "exit", e: expr | null } | { s: "return", e: expr | null } | { s: "break" } | { s: "continue" } | { s: "delete", name: string, subs: expr[] | null }
type rule = { kind: "begin" | "end" | "rule", pattern: expr | null, to: expr | null, body: stmt | null }
type fn = { params: string[], body: stmt }

class awk_error extends Error {}

class awk_parser {
    at = 0
    funcs = new Map<string, fn>()
    constructor(private toks: tok[]) {}
    get cur(): tok { return this.toks[this.at] }
    is(t: tok["t"], v?: string): boolean { return this.cur.t === t && (v === undefined || this.cur.v === v) }
    op(v: string): boolean { return this.is("op", v) }
    eat(t: tok["t"], v?: string): tok {
        if (!this.is(t, v)) throw new awk_error(`syntax error near '${this.cur.v || "end of program"}'`)
        return this.toks[this.at++]
    }
    skip_nl(): void { while (this.is("nl") || this.op(";")) this.at++ }
    only_nl(): void { while (this.is("nl")) this.at++ }

    program(): rule[] {
        const rules: rule[] = []
        this.skip_nl()
        while (!this.is("eof")) {
            if (this.is("kw", "function")) this.func()
            else if (this.is("kw", "BEGIN") || this.is("kw", "END")) {
                const kind = this.toks[this.at++].v === "BEGIN" ? "begin" : "end"
                this.only_nl()
                rules.push({ kind, pattern: null, to: null, body: this.block() })
            } else {
                let pattern: expr | null = null
                let to: expr | null = null
                if (!this.op("{")) {
                    pattern = this.expr()
                    if (this.op(",")) {
                        this.at++
                        this.only_nl()
                        to = this.expr()
                    }
                }
                rules.push({ kind: "rule", pattern, to, body: this.op("{") ? this.block() : null })
            }
            this.skip_nl()
        }
        return rules
    }

    func(): void {
        this.at++
        const name = this.toks[this.at++].v
        this.eat("op", "(")
        const params: string[] = []
        while (!this.op(")")) {
            params.push(this.eat("name").v)
            if (this.op(",")) this.at++
            this.only_nl()
        }
        this.at++
        this.only_nl()
        this.funcs.set(name, { params, body: this.block() })
    }

    block(): stmt {
        this.eat("op", "{")
        const body: stmt[] = []
        this.skip_nl()
        while (!this.op("}")) {
            if (this.is("eof")) throw new awk_error("missing }")
            body.push(this.stmt())
            this.skip_nl()
        }
        this.at++
        return { s: "block", body }
    }

    end_stmt(): void {
        if (this.op(";") || this.is("nl")) this.at++
        else if (!this.op("}") && !this.is("eof")) throw new awk_error(`syntax error near '${this.cur.v}'`)
    }

    simple_or_block(): stmt {
        this.only_nl()
        if (this.op(";")) {
            this.at++
            return { s: "block", body: [] }
        }
        return this.stmt()
    }

    stmt(): stmt {
        if (this.op("{")) return this.block()
        if (this.is("kw")) {
            const word = this.cur.v
            if (word === "if") {
                this.at++
                this.eat("op", "(")
                const c = this.expr()
                this.eat("op", ")")
                const a = this.simple_or_block()
                const save = this.at
                this.skip_nl()
                if (this.is("kw", "else")) {
                    this.at++
                    return { s: "if", c, a, b: this.simple_or_block() }
                }
                this.at = save
                return { s: "if", c, a, b: null }
            }
            if (word === "while") {
                this.at++
                this.eat("op", "(")
                const c = this.expr()
                this.eat("op", ")")
                return { s: "while", c, body: this.simple_or_block() }
            }
            if (word === "do") {
                this.at++
                const body = this.simple_or_block()
                this.skip_nl()
                this.eat("kw", "while")
                this.eat("op", "(")
                const c = this.expr()
                this.eat("op", ")")
                this.end_stmt()
                return { s: "do", c, body }
            }
            if (word === "for") {
                this.at++
                this.eat("op", "(")
                if (this.is("name") && this.toks[this.at + 1].v === "in" && this.toks[this.at + 3]?.v === ")") {
                    const v = this.toks[this.at].v
                    const arr = this.toks[this.at + 2].v
                    this.at += 4
                    return { s: "forin", v, arr, body: this.simple_or_block() }
                }
                const init = this.op(";") ? null : this.simple()
                this.eat("op", ";")
                this.only_nl()
                const c = this.op(";") ? null : this.expr()
                this.eat("op", ";")
                this.only_nl()
                const step = this.op(")") ? null : this.simple()
                this.eat("op", ")")
                return { s: "for", init, c, step, body: this.simple_or_block() }
            }
            if (word === "next") { this.at++; this.end_stmt(); return { s: "next" } }
            if (word === "break") { this.at++; this.end_stmt(); return { s: "break" } }
            if (word === "continue") { this.at++; this.end_stmt(); return { s: "continue" } }
            if (word === "exit" || word === "return") {
                this.at++
                const e = this.op(";") || this.op("}") || this.is("nl") || this.is("eof") ? null : this.expr()
                this.end_stmt()
                return word === "exit" ? { s: "exit", e } : { s: "return", e }
            }
            if (word === "delete") {
                this.at++
                const name = this.eat("name").v
                let subs: expr[] | null = null
                if (this.op("[")) {
                    this.at++
                    subs = this.expr_list("]")
                }
                this.end_stmt()
                return { s: "delete", name, subs }
            }
        }
        const s = this.simple()
        this.end_stmt()
        return s
    }

    simple(): stmt {
        if (this.is("kw", "print") || this.is("kw", "printf")) {
            const printf = this.toks[this.at++].v === "printf"
            let args: expr[] = []
            let parens = false
            if (!(this.op(";") || this.op("}") || this.is("nl") || this.is("eof"))) {
                if (this.op("(")) {
                    const save = this.at
                    this.at++
                    const list = this.expr_list(")")
                    if (this.op(";") || this.op("}") || this.is("nl") || this.is("eof")) {
                        args = list
                        parens = true
                    } else {
                        this.at = save
                        args = this.print_list()
                    }
                } else args = this.print_list()
            }
            return printf ? { s: "printf", args } : { s: "print", args, parens }
        }
        return { s: "expr", e: this.expr() }
    }

    print_list(): expr[] {
        const list = [this.expr(true)]
        while (this.op(",")) {
            this.at++
            this.only_nl()
            list.push(this.expr(true))
        }
        return list
    }

    expr_list(close: string): expr[] {
        const list: expr[] = []
        this.only_nl()
        while (!this.op(close)) {
            list.push(this.expr())
            this.only_nl()
            if (this.op(",")) {
                this.at++
                this.only_nl()
            } else if (!this.op(close)) throw new awk_error(`syntax error near '${this.cur.v}'`)
        }
        this.at++
        return list
    }

    // no_gt: inside print the > would be a redirection, which is not supported, so it is a plain comparison
    expr(no_gt: boolean = false): expr { return this.assign(no_gt) }

    assign(no_gt: boolean): expr {
        const left = this.ternary(no_gt)
        if (this.is("op") && ["=", "+=", "-=", "*=", "/=", "%=", "^="].includes(this.cur.v) && ["var", "index", "field"].includes(left.k)) {
            const op = this.toks[this.at++].v
            return { k: "assign", op, to: left, e: this.assign(no_gt) }
        }
        return left
    }

    ternary(no_gt: boolean): expr {
        const c = this.or(no_gt)
        if (this.op("?")) {
            this.at++
            this.only_nl()
            const a = this.assign(no_gt)
            this.only_nl()
            this.eat("op", ":")
            this.only_nl()
            return { k: "cond", c, a, b: this.assign(no_gt) }
        }
        return c
    }

    or(no_gt: boolean): expr {
        let a = this.and(no_gt)
        while (this.op("||")) {
            this.at++
            this.only_nl()
            a = { k: "bin", op: "||", a, b: this.and(no_gt) }
        }
        return a
    }

    and(no_gt: boolean): expr {
        let a = this.in_expr(no_gt)
        while (this.op("&&")) {
            this.at++
            this.only_nl()
            a = { k: "bin", op: "&&", a, b: this.in_expr(no_gt) }
        }
        return a
    }

    in_expr(no_gt: boolean): expr {
        let a = this.match(no_gt)
        while (this.is("kw", "in")) {
            this.at++
            a = { k: "in", subs: a.k === "group" ? [a.e] : [a], name: this.eat("name").v }
        }
        return a
    }

    match(no_gt: boolean): expr {
        let a = this.compare(no_gt)
        while (this.op("~") || this.op("!~")) {
            const op = this.toks[this.at++].v
            a = { k: "bin", op, a, b: this.compare(no_gt) }
        }
        return a
    }

    compare(no_gt: boolean): expr {
        const a = this.concat(no_gt)
        if (this.is("op") && ["<", "<=", "==", "!=", ">=", ">"].includes(this.cur.v) && !(no_gt && this.cur.v === ">")) {
            const op = this.toks[this.at++].v
            return { k: "bin", op, a, b: this.concat(no_gt) }
        }
        return a
    }

    starts_operand(): boolean {
        const t = this.cur
        if (t.t === "num" || t.t === "str" || t.t === "re" || t.t === "name" || t.t === "func") return true
        if (t.t === "op") return ["$", "!", "(", "-", "+", "++", "--"].includes(t.v) && !["-", "+"].includes(t.v)
        return false
    }

    concat(no_gt: boolean): expr {
        let a = this.additive()
        while (this.starts_operand() && !this.is("kw")) a = { k: "bin", op: " ", a, b: this.additive() }
        void no_gt
        return a
    }

    additive(): expr {
        let a = this.mult()
        while (this.op("+") || this.op("-")) {
            const op = this.toks[this.at++].v
            a = { k: "bin", op, a, b: this.mult() }
        }
        return a
    }

    mult(): expr {
        let a = this.unary()
        while (this.op("*") || this.op("/") || this.op("%")) {
            const op = this.toks[this.at++].v
            a = { k: "bin", op, a, b: this.unary() }
        }
        return a
    }

    unary(): expr {
        if (this.op("!") || this.op("-") || this.op("+")) {
            const op = this.toks[this.at++].v
            return { k: "un", op, e: this.unary() }
        }
        return this.power()
    }

    power(): expr {
        const a = this.postfix()
        if (this.op("^")) {
            this.at++
            return { k: "bin", op: "^", a, b: this.unary() }
        }
        return a
    }

    postfix(): expr {
        if (this.op("++") || this.op("--")) {
            const op = this.toks[this.at++].v
            return { k: "incr", op, pre: true, to: this.postfix() }
        }
        const e = this.primary()
        if ((this.op("++") || this.op("--")) && ["var", "index", "field"].includes(e.k)) return { k: "incr", op: this.toks[this.at++].v, pre: false, to: e }
        return e
    }

    primary(): expr {
        const t = this.cur
        if (t.t === "num") { this.at++; return { k: "num", v: Number(t.v) } }
        if (t.t === "str") { this.at++; return { k: "str", v: t.v } }
        if (t.t === "re") { this.at++; return { k: "re", v: t.v } }
        if (t.t === "op" && t.v === "$") {
            this.at++
            return { k: "field", e: this.op("++") || this.op("--") ? this.postfix() : this.primary() }
        }
        if (t.t === "op" && t.v === "(") {
            this.at++
            const list = this.expr_list(")")
            if (this.is("kw", "in") && list.length > 1) {
                this.at++
                return { k: "in", subs: list, name: this.eat("name").v }
            }
            return { k: "group", e: list[0] }
        }
        if (t.t === "func") {
            this.at += 2
            return { k: "call", name: t.v, args: this.expr_list(")") }
        }
        if (t.t === "name") {
            this.at++
            if (this.op("[")) {
                this.at++
                return { k: "index", name: t.v, subs: this.expr_list("]") }
            }
            return { k: "var", name: t.v }
        }
        throw new awk_error(`syntax error near '${t.v || "end of program"}'`)
    }
}

class next_signal {}
class exit_signal { constructor(public code: number) {} }
class return_signal { constructor(public value: val) {} }
class break_signal {}
class continue_signal {}

type frame = { vars: Map<string, val>, arrays: Map<string, Map<string, val>> }

class interpreter {
    globals: frame = { vars: new Map(), arrays: new Map() }
    frames: frame[] = []
    fields: string[] = []
    record = ""
    nf = 0
    out: string[] = []
    regex_cache = new Map<string, RegExp>()
    ranges = new WeakMap<rule, boolean>()
    exit_code = 0
    random = Math.random

    constructor(private p: proc_api, private funcs: Map<string, fn>) {
        this.set_var("FS", " ")
        this.set_var("OFS", " ")
        this.set_var("ORS", "\n")
        this.set_var("NR", 0)
        this.set_var("FNR", 0)
        this.set_var("NF", 0)
        this.set_var("SUBSEP", "\x1c")
        this.set_var("RSTART", 0)
        this.set_var("RLENGTH", -1)
        this.set_var("FILENAME", "")
    }

    flush(): void {
        if (this.out.length > 0) this.p.stdout.write(this.out.join(""))
        this.out = []
    }

    num(v: val): number {
        if (typeof v === "number") return v
        const text = v instanceof strnum ? v.s : v
        const m = /^\s*[-+]?(?:0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?|inf(?:inity)?|nan)/i.exec(text)
        return m ? Number(m[0]) : 0
    }

    str(v: val): string {
        if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(6)))
        return v instanceof strnum ? v.s : v
    }

    bool(v: val): boolean {
        if (typeof v === "number") return v !== 0
        if (v instanceof strnum) return /^\s*[-+]?(\d+\.?\d*|\.\d+)\s*$/.test(v.s) ? Number(v.s) !== 0 : v.s !== ""
        return v !== ""
    }

    looks_numeric(v: val): boolean {
        return typeof v === "number" || (v instanceof strnum && /^\s*[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?\s*$/.test(v.s))
    }

    get frame(): frame { return this.frames[this.frames.length - 1] ?? this.globals }

    get_var(name: string): val {
        if (name === "NF") return this.nf
        const local = this.frames.length > 0 && this.frame.vars.has(name)
        return (local ? this.frame : this.globals).vars.get(name) ?? ""
    }

    set_var(name: string, value: val): void {
        if (name === "NF") {
            this.nf = Math.max(0, Math.floor(this.num(value)))
            this.fields.length = this.nf
            for (let i = 0; i < this.nf; i++) this.fields[i] ??= ""
            this.rebuild()
            return
        }
        const local = this.frames.length > 0 && this.frame.vars.has(name)
        ;(local ? this.frame : this.globals).vars.set(name, value)
    }

    array(name: string): Map<string, val> {
        const local = this.frames.length > 0 && this.frame.arrays.has(name)
        const owner = local ? this.frame : this.globals
        let found = owner.arrays.get(name)
        if (!found) {
            found = new Map()
            owner.arrays.set(name, found)
        }
        return found
    }

    regex(source: string): RegExp {
        let found = this.regex_cache.get(source)
        if (!found) {
            found = new RegExp(make_regex(source, true))
            this.regex_cache.set(source, found)
        }
        return found
    }

    set_record(text: string): void {
        this.record = text
        const fs = this.str(this.get_var("FS"))
        let parts: string[]
        if (text === "") parts = []
        else if (fs === " ") parts = text.trim().split(/[ \t\n]+/).filter(Boolean)
        else if (fs === "\t" || (fs.length === 1 && fs !== "\\")) parts = text.split(fs)
        else parts = text.split(this.regex(fs))
        this.fields = parts
        this.nf = parts.length
    }

    rebuild(): void {
        this.record = this.fields.join(this.str(this.get_var("OFS")))
    }

    field(n: number): val {
        if (n === 0) return new strnum(this.record)
        return new strnum(this.fields[n - 1] ?? "")
    }

    set_field(n: number, value: string): void {
        if (n === 0) {
            this.set_record(value)
            return
        }
        while (this.fields.length < n) this.fields.push("")
        this.fields[n - 1] = value
        this.nf = this.fields.length
        this.rebuild()
    }

    key(subs: expr[]): string {
        return subs.map(sub => this.str(this.eval(sub))).join(this.str(this.get_var("SUBSEP")))
    }

    assign_to(target: expr, value: val): void {
        if (target.k === "var") this.set_var(target.name, value)
        else if (target.k === "index") this.array(target.name).set(this.key(target.subs), value)
        else if (target.k === "field") this.set_field(Math.floor(this.num(this.eval(target.e))), this.str(value))
    }

    compare(a: val, b: val): number {
        if (this.looks_numeric(a) && this.looks_numeric(b)) return this.num(a) - this.num(b)
        const x = this.str(a)
        const y = this.str(b)
        return x < y ? -1 : x > y ? 1 : 0
    }

    regex_of(e: expr): RegExp {
        return e.k === "re" ? this.regex(e.v) : this.regex(this.str(this.eval(e)))
    }

    eval(e: expr): val {
        switch (e.k) {
            case "num": return e.v
            case "str": return e.v
            case "re": return this.regex(e.v).test(this.record) ? 1 : 0
            case "group": return this.eval(e.e)
            case "var": return this.get_var(e.name)
            case "index": {
                const array = this.array(e.name)
                const key = this.key(e.subs)
                if (!array.has(key)) array.set(key, "")
                return array.get(key)!
            }
            case "field": return this.field(Math.floor(this.num(this.eval(e.e))))
            case "in": return this.array(e.name).has(this.key(e.subs)) ? 1 : 0
            case "cond": return this.bool(this.eval(e.c)) ? this.eval(e.a) : this.eval(e.b)
            case "assign": {
                let value: val
                if (e.op === "=") value = this.eval(e.e)
                else {
                    const current = this.num(this.eval(e.to))
                    const rhs = this.num(this.eval(e.e))
                    const op = e.op[0]
                    value = op === "+" ? current + rhs : op === "-" ? current - rhs : op === "*" ? current * rhs : op === "/" ? current / rhs : op === "%" ? current % rhs : current ** rhs
                }
                this.assign_to(e.to, value)
                return value
            }
            case "incr": {
                const old = this.num(this.eval(e.to))
                const next = e.op === "++" ? old + 1 : old - 1
                this.assign_to(e.to, next)
                return e.pre ? next : old
            }
            case "un": {
                const v = this.eval(e.e)
                return e.op === "!" ? (this.bool(v) ? 0 : 1) : e.op === "-" ? -this.num(v) : this.num(v)
            }
            case "bin": return this.binary(e)
            case "call": return this.call(e)
        }
    }

    binary(e: Extract<expr, { k: "bin" }>): val {
        if (e.op === "&&") return this.bool(this.eval(e.a)) && this.bool(this.eval(e.b)) ? 1 : 0
        if (e.op === "||") return this.bool(this.eval(e.a)) || this.bool(this.eval(e.b)) ? 1 : 0
        if (e.op === "~" || e.op === "!~") {
            const hit = this.regex_of(e.b).test(this.str(this.eval(e.a)))
            return hit === (e.op === "~") ? 1 : 0
        }
        const a = this.eval(e.a)
        const b = this.eval(e.b)
        switch (e.op) {
            case " ": return this.str(a) + this.str(b)
            case "+": return this.num(a) + this.num(b)
            case "-": return this.num(a) - this.num(b)
            case "*": return this.num(a) * this.num(b)
            case "/": {
                if (this.num(b) === 0) throw new awk_error("division by zero")
                return this.num(a) / this.num(b)
            }
            case "%": {
                if (this.num(b) === 0) throw new awk_error("division by zero in %")
                return this.num(a) % this.num(b)
            }
            case "^": return this.num(a) ** this.num(b)
            case "<": return this.compare(a, b) < 0 ? 1 : 0
            case "<=": return this.compare(a, b) <= 0 ? 1 : 0
            case ">": return this.compare(a, b) > 0 ? 1 : 0
            case ">=": return this.compare(a, b) >= 0 ? 1 : 0
            case "==": return this.compare(a, b) === 0 ? 1 : 0
            case "!=": return this.compare(a, b) !== 0 ? 1 : 0
        }
        throw new awk_error(`unknown operator ${e.op}`)
    }

    call(e: Extract<expr, { k: "call" }>): val {
        const args = e.args
        const arg = (i: number): val => (args[i] ? this.eval(args[i]) : "")
        const user = this.funcs.get(e.name)
        if (user) {
            const frame: frame = { vars: new Map(), arrays: new Map() }
            user.params.forEach((param, i) => {
                const given = args[i]
                if (given && given.k === "var" && this.is_array(given.name)) frame.arrays.set(param, this.array(given.name))
                else if (given) frame.vars.set(param, this.eval(given))
                else frame.vars.set(param, "")
            })
            if (this.frames.length > 300) throw new awk_error("function call nesting too deep")
            this.frames.push(frame)
            try {
                this.exec(user.body)
                return ""
            } catch (signal) {
                if (signal instanceof return_signal) return signal.value
                throw signal
            } finally {
                this.frames.pop()
            }
        }
        switch (e.name) {
            case "length": {
                if (args.length === 0) return this.record.length
                if (args[0].k === "var" && this.is_array(args[0].name)) return this.array(args[0].name).size
                return this.str(arg(0)).length
            }
            case "substr": {
                const s = this.str(arg(0))
                const start = Math.round(this.num(arg(1)))
                const from = Math.max(1, start)
                const end = args[2] ? start + Math.round(this.num(arg(2))) : s.length + 1
                return s.slice(from - 1, Math.max(from - 1, end - 1))
            }
            case "index": return this.str(arg(0)).indexOf(this.str(arg(1))) + 1
            case "split": {
                const s = this.str(arg(0))
                const target = args[1]
                if (!target || target.k !== "var") throw new awk_error("split: second argument must be an array")
                const separator = args[2] ? (args[2].k === "re" ? args[2].v : this.str(this.eval(args[2]))) : this.str(this.get_var("FS"))
                const array = this.array(target.name)
                array.clear()
                const parts = s === "" ? [] : separator === " " ? s.trim().split(/[ \t\n]+/) : separator.length === 1 ? s.split(separator) : s.split(this.regex(separator))
                parts.forEach((part, i) => array.set(String(i + 1), new strnum(part)))
                return parts.length
            }
            case "sub":
            case "gsub": {
                const regex = new RegExp(this.regex_of(args[0]).source, e.name === "gsub" ? "g" : "")
                const target = args[2] ?? ({ k: "field", e: { k: "num", v: 0 } } as expr)
                const source = this.str(this.eval(target))
                const replacement = this.str(arg(1))
                let count = 0
                const result = source.replace(regex, (...m) => {
                    count++
                    const found = m[0] as string
                    return replacement.replace(/\\&|&|\\\\/g, piece => (piece === "&" ? found : piece === "\\&" ? "&" : "\\"))
                })
                if (count > 0) this.assign_to(target, result)
                return count
            }
            case "match": {
                const m = this.regex_of(args[1]).exec(this.str(arg(0)))
                this.set_var("RSTART", m ? m.index + 1 : 0)
                this.set_var("RLENGTH", m ? m[0].length : -1)
                return m ? m.index + 1 : 0
            }
            case "sprintf": return format_printf(this.str(arg(0)), args.slice(1).map((_, i) => this.str(arg(i + 1))))
            case "toupper": return this.str(arg(0)).toUpperCase()
            case "tolower": return this.str(arg(0)).toLowerCase()
            case "int": return Math.trunc(this.num(arg(0)))
            case "sqrt": return Math.sqrt(this.num(arg(0)))
            case "sin": return Math.sin(this.num(arg(0)))
            case "cos": return Math.cos(this.num(arg(0)))
            case "atan2": return Math.atan2(this.num(arg(0)), this.num(arg(1)))
            case "exp": return Math.exp(this.num(arg(0)))
            case "log": return Math.log(this.num(arg(0)))
            case "rand": return this.random()
            case "srand": return 0
            case "system": return 0
        }
        throw new awk_error(`calling undefined function ${e.name}`)
    }

    is_array(name: string): boolean {
        return this.frame.arrays.has(name) || this.globals.arrays.has(name)
    }

    print_args(args: expr[], parens: boolean): string {
        void parens
        return args.length === 0 ? this.record : args.map(a => this.str(this.eval(a))).join(this.str(this.get_var("OFS")))
    }

    exec(s: stmt): void {
        switch (s.s) {
            case "expr": this.eval(s.e); break
            case "print":
                this.out.push(this.print_args(s.args, s.parens) + this.str(this.get_var("ORS")))
                if (this.out.length > 500) this.flush()
                break
            case "printf":
                this.out.push(format_printf(this.str(this.eval(s.args[0])), s.args.slice(1).map(a => this.str(this.eval(a)))))
                break
            case "block": for (const inner of s.body) this.exec(inner); break
            case "if":
                if (this.bool(this.eval(s.c))) this.exec(s.a)
                else if (s.b) this.exec(s.b)
                break
            case "while":
                while (this.bool(this.eval(s.c))) {
                    if (this.loop(s.body)) break
                }
                break
            case "do":
                do {
                    if (this.loop(s.body)) break
                } while (this.bool(this.eval(s.c)))
                break
            case "for":
                if (s.init) this.exec(s.init)
                while (!s.c || this.bool(this.eval(s.c))) {
                    if (this.loop(s.body)) break
                    if (s.step) this.exec(s.step)
                }
                break
            case "forin":
                for (const key of [...this.array(s.arr).keys()]) {
                    this.set_var(s.v, new strnum(key))
                    if (this.loop(s.body)) break
                }
                break
            case "next": throw new next_signal()
            case "exit": throw new exit_signal(s.e ? Math.floor(this.num(this.eval(s.e))) : this.exit_code)
            case "return": throw new return_signal(s.e ? this.eval(s.e) : "")
            case "break": throw new break_signal()
            case "continue": throw new continue_signal()
            case "delete":
                if (s.subs) this.array(s.name).delete(this.key(s.subs))
                else this.array(s.name).clear()
                break
        }
    }

    // runs a loop body; true when it ended with break
    loop(body: stmt): boolean {
        try {
            this.exec(body)
        } catch (signal) {
            if (signal instanceof break_signal) return true
            if (!(signal instanceof continue_signal)) throw signal
        }
        return false
    }
}

export const awk_program: program = async p => {
    const args = p.argv.slice(1)
    let program_text: string | null = null
    let separator: string | null = null
    const assigns: [string, string][] = []
    const files: string[] = []
    for (let i = 0; i < args.length; i++) {
        const arg = args[i]
        if (program_text === null && arg === "-F") separator = args[++i] ?? ""
        else if (program_text === null && arg.startsWith("-F")) separator = arg.slice(2)
        else if (program_text === null && arg === "-v") {
            const text = args[++i] ?? ""
            const eq = text.indexOf("=")
            assigns.push([text.slice(0, eq), text.slice(eq + 1)])
        } else if (program_text === null && arg === "-f") {
            try {
                program_text = await p.fs.read(absolute(p.cwd, args[++i] ?? ""))
            } catch {
                p.stderr.write(`awk: can't open file ${args[i]}\n`)
                return 2
            }
        } else if (program_text === null && arg === "--") continue
        else if (program_text === null) program_text = arg
        else files.push(arg)
    }
    if (program_text === null) {
        p.stderr.write("usage: awk [-F fs][-v var=value] 'program' [file ...]\n")
        return 2
    }
    let rules: rule[]
    let parser: awk_parser
    try {
        parser = new awk_parser(lex_awk(program_text))
        rules = parser.program()
    } catch (error) {
        p.stderr.write(`awk: ${error instanceof Error ? error.message : String(error)}\n`)
        return 2
    }
    const run = new interpreter(p, parser.funcs)
    if (separator !== null) run.set_var("FS", separator.replace(/\\t/g, "\t"))
    for (const [name, value] of assigns) run.set_var(name, new strnum(value.replace(/\\n/g, "\n").replace(/\\t/g, "\t")))
    let code = 0
    try {
        let exiting = false
        try {
            for (const rule of rules) if (rule.kind === "begin") run.exec(rule.body!)
        } catch (signal) {
            if (signal instanceof exit_signal) {
                code = signal.code
                exiting = true
            } else throw signal
        }
        const main = rules.filter(rule => rule.kind === "rule")
        if (!exiting && (main.length > 0 || rules.some(rule => rule.kind === "end"))) {
            const inputs: { name: string, text: string }[] = []
            if (files.length === 0) {
                const parts: string[] = []
                for (;;) {
                    const chunk = await p.stdin.read()
                    if (chunk === null) break
                    parts.push(chunk)
                }
                inputs.push({ name: "", text: parts.join("") })
            } else {
                for (const name of files) {
                    try {
                        inputs.push({ name, text: await p.fs.read(absolute(p.cwd, name)) })
                    } catch {
                        p.stderr.write(`awk: cannot open "${name}" (No such file or directory)\n`)
                        code = 2
                    }
                }
            }
            let nr = 0
            outer: for (const input of inputs) {
                run.set_var("FILENAME", input.name)
                let fnr = 0
                const lines = input.text === "" ? [] : input.text.split("\n")
                if (input.text.endsWith("\n")) lines.pop()
                for (const line of lines) {
                    nr++
                    fnr++
                    run.set_var("NR", nr)
                    run.set_var("FNR", fnr)
                    run.set_record(line)
                    try {
                        for (const rule of main) {
                            let hit: boolean
                            if (!rule.pattern) hit = true
                            else if (rule.to) {
                                const open = run.ranges.get(rule) ?? false
                                if (open) {
                                    hit = true
                                    if (run.bool(run.eval(rule.to))) run.ranges.set(rule, false)
                                } else if (run.bool(run.eval(rule.pattern))) {
                                    hit = true
                                    run.ranges.set(rule, !run.bool(run.eval(rule.to)))
                                } else hit = false
                            } else hit = run.bool(run.eval(rule.pattern))
                            if (!hit) continue
                            if (rule.body) run.exec(rule.body)
                            else run.out.push(run.record + run.str(run.get_var("ORS")))
                        }
                    } catch (signal) {
                        if (signal instanceof next_signal) continue
                        if (signal instanceof exit_signal) {
                            code = signal.code
                            break outer
                        }
                        throw signal
                    }
                    if (nr % 200 === 0) {
                        run.flush()
                        await new Promise<void>(done => setTimeout(done, 0))
                        if (p.signal.aborted) return 130
                    }
                }
            }
        }
        try {
            for (const rule of rules) if (rule.kind === "end") run.exec(rule.body!)
        } catch (signal) {
            if (signal instanceof exit_signal) code = signal.code
            else if (!(signal instanceof next_signal)) throw signal
        }
    } catch (error) {
        run.flush()
        p.stderr.write(`awk: ${error instanceof Error ? error.message : String(error)}\n`)
        return 2
    }
    run.flush()
    return code
}
