// sed: the stream editor. Commands s y d p q = n N a i c h H g G x, addresses (N, $, /re/, N,M, first~step is not supported), ! and { }.

import type { proc_api, program } from "./proc_types.ts"
import { absolute } from "./desk_sh.ts"
import { make_regex } from "./desk_regex.ts"

type address = { kind: "line", n: number } | { kind: "last" } | { kind: "re", re: RegExp | null } | { kind: "step", from: number, step: number }
type command = {
    from: address | null, to: address | null, negate: boolean, name: string
    re?: RegExp | null, repl?: string, global?: boolean, print?: boolean, nth?: number
    text?: string, from_chars?: string[], to_chars?: string[], body?: command[]
    // state of a range: whether it is open, and the line it ends on when that is a count
    open?: boolean, end_line?: number
}

class script_error extends Error {}

function compile(source: string, flags: string, extended: boolean): RegExp | null {
    if (source === "") return null
    return new RegExp(make_regex(source, extended), flags)
}

function parse_script(script: string, extended: boolean): command[] {
    let at = 0
    const skip_space = (): void => {
        while (at < script.length && (script[at] === " " || script[at] === "\t")) at++
    }
    // text up to an unescaped delimiter (the delimiter itself is dropped)
    const until = (delimiter: string): string => {
        let out = ""
        while (at < script.length && script[at] !== delimiter) {
            if (script[at] === "\\" && at + 1 < script.length) {
                // an escaped delimiter is the delimiter itself; any other escape stays for the regex or the replacement
                if (script[at + 1] === delimiter) out += delimiter === "/" || delimiter === "|" ? (delimiter === "|" ? "\\|" : "/") : delimiter
                else out += script[at] + script[at + 1]
                at += 2
            } else out += script[at++]
        }
        if (at >= script.length) throw new script_error("unterminated command")
        at++
        return out
    }
    const address = (): address | null => {
        skip_space()
        const c = script[at]
        if (c === "$") {
            at++
            return { kind: "last" }
        }
        if (c !== undefined && /\d/.test(c)) {
            let digits = ""
            while (/\d/.test(script[at] ?? "")) digits += script[at++]
            if (script[at] === "~") {
                at++
                let step = ""
                while (/\d/.test(script[at] ?? "")) step += script[at++]
                return { kind: "step", from: Number(digits), step: Number(step || 0) }
            }
            return { kind: "line", n: Number(digits) }
        }
        if (c === "/" || c === "\\") {
            let delimiter = "/"
            if (c === "\\") delimiter = script[++at]
            at++
            const source = until(delimiter)
            let flag = ""
            while (script[at] === "I") {
                flag = "i"
                at++
            }
            return { kind: "re", re: compile(source, flag, extended) }
        }
        return null
    }
    const block = (closing: boolean): command[] => {
        const list: command[] = []
        for (;;) {
            while (at < script.length && (" \t\n;".includes(script[at]))) at++
            if (at >= script.length) {
                if (closing) throw new script_error("unmatched '{'")
                return list
            }
            if (script[at] === "}") {
                if (!closing) throw new script_error("unexpected '}'")
                at++
                return list
            }
            if (script[at] === "#") {
                while (at < script.length && script[at] !== "\n") at++
                continue
            }
            const from = address()
            let to: address | null = null
            if (from) {
                skip_space()
                if (script[at] === ",") {
                    at++
                    skip_space()
                    if (script[at] === "+") {
                        at++
                        let digits = ""
                        while (/\d/.test(script[at] ?? "")) digits += script[at++]
                        to = { kind: "line", n: -Number(digits) }
                    } else to = address()
                    if (!to) throw new script_error("expected address after ','")
                }
            }
            skip_space()
            let negate = false
            while (script[at] === "!") {
                negate = true
                at++
                skip_space()
            }
            const name = script[at++]
            if (name === undefined) throw new script_error("missing command")
            const command: command = { from, to, negate, name }
            if (name === "{") command.body = block(true)
            else if (name === "s") {
                const delimiter = script[at++]
                const pattern = until(delimiter)
                const replacement = until(delimiter)
                let flags = ""
                let nth = 0
                for (;;) {
                    const f = script[at]
                    if (f === "g") command.global = true
                    else if (f === "p") command.print = true
                    else if (f === "i" || f === "I") flags += "i"
                    else if (f !== undefined && /\d/.test(f)) {
                        let digits = ""
                        while (/\d/.test(script[at] ?? "")) digits += script[at++]
                        nth = Number(digits)
                        continue
                    } else break
                    at++
                }
                command.re = compile(pattern, flags, extended)
                command.repl = replacement
                command.nth = nth
            } else if (name === "y") {
                const delimiter = script[at++]
                const left = until(delimiter)
                const right = until(delimiter)
                command.from_chars = [...left.replace(/\\n/g, "\n").replace(/\\(.)/g, "$1")]
                command.to_chars = [...right.replace(/\\n/g, "\n").replace(/\\(.)/g, "$1")]
                if (command.from_chars.length !== command.to_chars.length) throw new script_error("strings for 'y' command are different lengths")
            } else if (name === "a" || name === "i" || name === "c") {
                skip_space()
                if (script[at] === "\\") {
                    at++
                    if (script[at] === "\n") at++
                    else skip_space()
                }
                let text = ""
                while (at < script.length && script[at] !== "\n") {
                    if (script[at] === "\\" && at + 1 < script.length) at++
                    text += script[at++]
                }
                command.text = text
            } else if (!"dpPqQ=nNhHgGxD".includes(name)) throw new script_error(`unknown command: '${name}'`)
            list.push(command)
        }
    }
    return block(false)
}

function matches_address(a: address, line: number, last: boolean, text: string): boolean {
    if (a.kind === "line") return line === a.n
    if (a.kind === "last") return last
    if (a.kind === "step") return a.step === 0 ? line === a.from : line >= a.from && (line - a.from) % a.step === 0
    return a.re ? a.re.test(text) : false
}

function replacement_text(repl: string, match: RegExpExecArray): string {
    let out = ""
    for (let i = 0; i < repl.length; i++) {
        const c = repl[i]
        if (c === "&") out += match[0]
        else if (c === "\\" && i + 1 < repl.length) {
            const next = repl[++i]
            if (/[0-9]/.test(next)) out += match[Number(next)] ?? ""
            else if (next === "n") out += "\n"
            else if (next === "t") out += "\t"
            else out += next
        } else out += c
    }
    return out
}

function substitute(command: command, line: string, last_re: { re: RegExp | null }): { text: string, changed: boolean } {
    const base = command.re ?? last_re.re
    if (!base) throw new script_error("no previous regular expression")
    last_re.re = base
    const regex = new RegExp(base.source, base.flags.replace("g", "") + "g")
    let out = ""
    let position = 0
    let count = 0
    let changed = false
    let match: RegExpExecArray | null
    regex.lastIndex = 0
    while ((match = regex.exec(line)) !== null) {
        count++
        const take = command.nth ? (command.global ? count >= command.nth : count === command.nth) : true
        if (match[0] === "") regex.lastIndex++
        if (take) {
            out += line.slice(position, match.index) + replacement_text(command.repl ?? "", match)
            position = match.index + match[0].length
            changed = true
            if (!command.global) break
        }
        if (regex.lastIndex > line.length) break
    }
    return { text: out + line.slice(position), changed }
}

async function run_sed(p: proc_api, commands: command[], lines: string[], quiet: boolean, offset: number, total_known: boolean, emit: (text: string) => void): Promise<number> {
    let hold = ""
    let quit = false
    let code = 0
    const last_re = { re: null as RegExp | null }
    for (let index = 0; index < lines.length && !quit; index++) {
        let pattern = lines[index]
        let line_number = index + 1 + offset
        const appended: string[] = []
        let deleted = false
        let printed = false
        const is_last = (at: number): boolean => at === lines.length - 1 && total_known
        let current = index
        let substituted = false
        const run = (list: command[]): boolean => {
            for (const command of list) {
                let selected: boolean
                if (!command.from) selected = true
                else if (!command.to) selected = matches_address(command.from, line_number, is_last(current), pattern)
                else {
                    if (command.open) {
                        selected = true
                        const end = command.to
                        const end_hit = end.kind === "line" && end.n < 0 ? line_number >= (command.end_line ?? 0) : matches_address(end, line_number, is_last(current), pattern)
                        if (end_hit || (end.kind === "line" && end.n > 0 && line_number >= end.n)) command.open = false
                    } else if (matches_address(command.from, line_number, is_last(current), pattern)) {
                        selected = true
                        const end = command.to
                        if (end.kind === "line" && end.n < 0) {
                            command.end_line = line_number - end.n
                            command.open = true
                        } else if (end.kind === "line") command.open = end.n > line_number
                        else if (end.kind === "re" || end.kind === "step") command.open = true
                        else command.open = !is_last(current)
                    } else selected = false
                }
                if (command.negate) selected = !selected
                if (!selected) continue
                switch (command.name) {
                    case "{":
                        if (run(command.body ?? [])) return true
                        break
                    case "s": {
                        const result = substitute(command, pattern, last_re)
                        if (result.changed) {
                            pattern = result.text
                            substituted = true
                            if (command.print) {
                                emit(pattern + "\n")
                                printed = true
                            }
                        }
                        break
                    }
                    case "y":
                        pattern = [...pattern].map(c => command.to_chars![command.from_chars!.indexOf(c)] ?? c).join("")
                        break
                    case "d": deleted = true; return true
                    case "D": {
                        const at = pattern.indexOf("\n")
                        if (at < 0) deleted = true
                        else pattern = pattern.slice(at + 1)
                        return true
                    }
                    case "p": emit(pattern + "\n"); break
                    case "P": emit(pattern.split("\n")[0] + "\n"); break
                    case "q": quit = true; return true
                    case "Q": quit = true; deleted = true; return true
                    case "=": emit(`${line_number}\n`); break
                    case "n":
                        if (!quiet) emit(pattern + "\n")
                        if (current + 1 >= lines.length) {
                            quit = true
                            deleted = true
                            return true
                        }
                        current++
                        index = current
                        line_number++
                        pattern = lines[current]
                        break
                    case "N":
                        if (current + 1 >= lines.length) {
                            quit = true
                            return true
                        }
                        current++
                        index = current
                        line_number++
                        pattern += "\n" + lines[current]
                        break
                    case "a": appended.push(command.text ?? ""); break
                    case "i": emit((command.text ?? "") + "\n"); break
                    case "c":
                        if (!command.to || !command.open) emit((command.text ?? "") + "\n")
                        deleted = true
                        return true
                    case "h": hold = pattern; break
                    case "H": hold += "\n" + pattern; break
                    case "g": pattern = hold; break
                    case "G": pattern += "\n" + hold; break
                    case "x": [pattern, hold] = [hold, pattern]; break
                }
            }
            return false
        }
        run(commands)
        if (!deleted && !quiet) emit(pattern + "\n")
        else if (!deleted && quiet && false) emit(pattern + "\n")
        for (const text of appended) emit(text + "\n")
        void printed
        void substituted
        if (p.signal.aborted) return 130
    }
    return code
}

export const sed_program: program = async p => {
    const args = p.argv.slice(1)
    const scripts: string[] = []
    const files: string[] = []
    let quiet = false
    let extended = false
    let in_place: string | null = null
    for (let i = 0; i < args.length; i++) {
        const arg = args[i]
        if (arg === "-n" || arg === "--quiet" || arg === "--silent") quiet = true
        else if (arg === "-E" || arg === "-r" || arg === "--regexp-extended") extended = true
        else if (arg === "-e") scripts.push(args[++i] ?? "")
        else if (arg === "-f") {
            try {
                scripts.push(await p.fs.read(absolute(p.cwd, args[++i] ?? "")))
            } catch {
                p.stderr.write(`sed: couldn't open file ${args[i]}: No such file or directory\n`)
                return 1
            }
        } else if (arg.startsWith("-i")) in_place = arg.slice(2)
        else if (arg === "--in-place") in_place = ""
        else if (arg === "-s") continue
        else if (/^-[nEr]+$/.test(arg)) {
            if (arg.includes("n")) quiet = true
            if (arg.includes("E") || arg.includes("r")) extended = true
        } else if (arg === "--") files.push(...args.slice(i + 1))
        else if (scripts.length === 0 && files.length === 0 && !arg.startsWith("-")) scripts.push(arg)
        else files.push(arg)
    }
    if (scripts.length === 0) {
        p.stderr.write("sed: no script given\n")
        return 1
    }
    let commands: command[]
    try {
        commands = parse_script(scripts.join("\n"), extended)
    } catch (error) {
        p.stderr.write(`sed: -e expression #1: ${error instanceof Error ? error.message : String(error)}\n`)
        return 1
    }
    const split = (text: string): { lines: string[], newline: boolean } => {
        const lines = text === "" ? [] : text.split("\n")
        const newline = text.endsWith("\n")
        if (newline) lines.pop()
        return { lines, newline }
    }
    try {
        if (files.length === 0) {
            let text = ""
            for (;;) {
                const chunk = await p.stdin.read()
                if (chunk === null) break
                text += chunk
            }
            const { lines } = split(text)
            return await run_sed(p, commands, lines, quiet, 0, true, out => p.stdout.write(out))
        }
        let status = 0
        if (in_place !== null) {
            for (const file of files) {
                const path = absolute(p.cwd, file)
                let text: string
                try {
                    text = await p.fs.read(path)
                } catch {
                    p.stderr.write(`sed: can't read ${file}: No such file or directory\n`)
                    status = 2
                    continue
                }
                const { lines, newline } = split(text)
                let out = ""
                await run_sed(p, commands, lines, quiet, 0, true, piece => { out += piece })
                if (!newline && out.endsWith("\n")) out = out.slice(0, -1)
                if (in_place !== "") await p.fs.write(path + in_place, text, false)
                await p.fs.write(path, out, false)
            }
            return status
        }
        // several files are one stream of lines
        const all: string[] = []
        for (const file of files) {
            try {
                all.push(...split(await p.fs.read(absolute(p.cwd, file))).lines)
            } catch {
                p.stderr.write(`sed: can't read ${file}: No such file or directory\n`)
                status = 2
            }
        }
        const code = await run_sed(p, commands, all, quiet, 0, true, out => p.stdout.write(out))
        return status || code
    } catch (error) {
        p.stderr.write(`sed: ${error instanceof Error ? error.message : String(error)}\n`)
        return 1
    }
}
