// The programs of the shell runtime, busybox style: one lazily loaded bundle holds the shell and the usual command-line utilities, so
// the first `pid:` loads everything at once and `grep`, `sed`, `awk` and the rest start without another request. Each program gets its
// process (client_proc_types.ts): arguments, three text streams, the file system.

import type { proc_api, program } from "./proc_types.ts"
import { absolute, base_name, dir_name, glob_match, normalize } from "./desk_sh.ts"
import { awk_program } from "./desk_awk.ts"
import { sed_program } from "./desk_sed.ts"
import { make_regex } from "./desk_regex.ts"
import { format_printf, unescape_text } from "./desk_printf.ts"

// ---- helpers ----------------------------------------------------------------------------------------------------------------------

type parsed = { flags: Record<string, string | true>, rest: string[], count: number | null }

// short options (-la, -n 5, -n5, -5) and long ones (--name=x); `with_value` lists the short letters that take a value
function getopt(args: string[], with_value: string = "", long_value: string[] = []): parsed {
    const flags: Record<string, string | true> = {}
    const rest: string[] = []
    let count: number | null = null
    for (let i = 0; i < args.length; i++) {
        const arg = args[i]
        if (arg === "--") {
            rest.push(...args.slice(i + 1))
            break
        }
        if (arg.startsWith("--") && arg.length > 2) {
            const eq = arg.indexOf("=")
            const name = eq < 0 ? arg.slice(2) : arg.slice(2, eq)
            if (eq >= 0) flags[name] = arg.slice(eq + 1)
            else if (long_value.includes(name)) flags[name] = args[++i] ?? ""
            else flags[name] = true
            continue
        }
        if (/^-\d+$/.test(arg)) {
            count = Number(arg.slice(1))
            continue
        }
        if (arg.startsWith("-") && arg.length > 1) {
            for (let j = 1; j < arg.length; j++) {
                const letter = arg[j]
                if (with_value.includes(letter)) {
                    flags[letter] = j + 1 < arg.length ? arg.slice(j + 1) : (args[++i] ?? "")
                    break
                }
                flags[letter] = true
            }
            continue
        }
        rest.push(arg)
    }
    return { flags, rest, count }
}

function name_of(p: proc_api): string {
    return base_name(p.argv[0])
}

function fail(p: proc_api, message: string): number {
    p.stderr.write(`${name_of(p)}: ${message}\n`)
    return 1
}

function message_of(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

function path_of(p: proc_api, name: string): string {
    return absolute(p.cwd, name)
}

async function read_all(p: proc_api): Promise<string> {
    const parts: string[] = []
    for (;;) {
        const chunk = await p.stdin.read()
        if (chunk === null) break
        parts.push(chunk)
    }
    return parts.join("")
}

async function read_file(p: proc_api, name: string): Promise<string | null> {
    if (name === "-") return read_all(p)
    try {
        const info = await p.fs.stat(path_of(p, name))
        if (!info) {
            p.stderr.write(`${name_of(p)}: ${name}: No such file or directory\n`)
            return null
        }
        if (info.kind === "dir") {
            p.stderr.write(`${name_of(p)}: ${name}: Is a directory\n`)
            return null
        }
        return await p.fs.read(path_of(p, name))
    } catch (error) {
        p.stderr.write(`${name_of(p)}: ${name}: ${message_of(error)}\n`)
        return null
    }
}

// the text of each file in turn (or of stdin when there are none); `status` is 1 when one could not be read
async function sources(p: proc_api, files: string[]): Promise<{ name: string, text: string }[] | { error: true, items: { name: string, text: string }[] }> {
    if (files.length === 0) return [{ name: "-", text: await read_all(p) }]
    const items: { name: string, text: string }[] = []
    let error = false
    for (const file of files) {
        const text = await read_file(p, file)
        if (text === null) error = true
        else items.push({ name: file, text })
    }
    return error ? { error: true, items } : items
}

async function each_source(p: proc_api, files: string[], use: (name: string, text: string, multiple: boolean) => void | Promise<void>): Promise<number> {
    const got = await sources(p, files)
    const items = Array.isArray(got) ? got : got.items
    for (const item of items) await use(item.name, item.text, files.length > 1)
    return Array.isArray(got) ? 0 : 1
}

function lines_of(text: string): string[] {
    if (text === "") return []
    const lines = text.split("\n")
    if (lines[lines.length - 1] === "") lines.pop()
    return lines
}

function sleep(p: proc_api, milliseconds: number): Promise<void> {
    return new Promise(done => {
        const timer = setTimeout(done, milliseconds)
        p.signal.addEventListener("abort", () => {
            clearTimeout(timer)
            done()
        }, { once: true })
    })
}

function pad(text: string, width: number, left: boolean = false): string {
    return left ? text.padEnd(width) : text.padStart(width)
}

// ---- echo, printf, test and the like ----------------------------------------------------------------------------------------------

const echo: program = async p => {
    let newline = true
    let escapes = false
    let at = 1
    while (at < p.argv.length && /^-[neE]+$/.test(p.argv[at])) {
        for (const letter of p.argv[at].slice(1)) {
            if (letter === "n") newline = false
            else if (letter === "e") escapes = true
            else escapes = false
        }
        at++
    }
    let text = p.argv.slice(at).join(" ")
    if (escapes) {
        const result = unescape_text(text, true)
        text = result.value
        if (result.stop) newline = false
    }
    p.stdout.write(text + (newline ? "\n" : ""))
    return 0
}

const printf: program = async p => {
    if (p.argv.length < 2) return fail(p, "usage: printf format [arguments]")
    p.stdout.write(format_printf(p.argv[1], p.argv.slice(2)))
    return 0
}

async function test_expression(p: proc_api, args: string[]): Promise<boolean> {
    let at = 0
    const peek = (): string | undefined => args[at]
    const unary_file = async (op: string, name: string): Promise<boolean> => {
        const info = await p.fs.stat(path_of(p, name))
        if (op === "-e") return !!info
        if (op === "-f") return info?.kind === "file"
        if (op === "-d") return info?.kind === "dir"
        if (op === "-s") return !!info && info.size > 0
        if (op === "-r" || op === "-x") return !!info
        if (op === "-w") return !!info?.writable
        return false
    }
    const primary = async (): Promise<boolean> => {
        const token = args[at++]
        if (token === undefined) return false
        if (token === "(") {
            const value = await or()
            if (args[at] === ")") at++
            return value
        }
        if (token === "!") return !(await primary())
        if (/^-[efdsrwx]$/.test(token) && args[at] !== undefined && !["=", "!=", "-eq", "-ne"].includes(args[at])) return unary_file(token, args[at++])
        if (token === "-z" && at < args.length) return args[at++] === ""
        if (token === "-n" && at < args.length) return args[at++] !== ""
        const op = args[at]
        if (op !== undefined && ["=", "==", "!=", "-eq", "-ne", "-lt", "-le", "-gt", "-ge", "<", ">"].includes(op)) {
            at += 2
            const right = args[at - 1]
            if (op === "=" || op === "==") return token === right
            if (op === "!=") return token !== right
            if (op === "<") return token < right
            if (op === ">") return token > right
            const a = Number(token)
            const b = Number(right)
            if (Number.isNaN(a) || Number.isNaN(b)) throw new Error("integer expression expected")
            return op === "-eq" ? a === b : op === "-ne" ? a !== b : op === "-lt" ? a < b : op === "-le" ? a <= b : op === "-gt" ? a > b : a >= b
        }
        return token !== ""
    }
    const and = async (): Promise<boolean> => {
        let value = await primary()
        while (peek() === "-a") {
            at++
            const right = await primary()
            value = value && right
        }
        return value
    }
    const or = async (): Promise<boolean> => {
        let value = await and()
        while (peek() === "-o") {
            at++
            const right = await and()
            value = value || right
        }
        return value
    }
    return or()
}

const test: program = async p => {
    let args = p.argv.slice(1)
    if (name_of(p) === "[") {
        if (args[args.length - 1] !== "]") return fail(p, "missing ']'") + 1
        args = args.slice(0, -1)
    }
    try {
        return (await test_expression(p, args)) ? 0 : 1
    } catch (error) {
        p.stderr.write(`${name_of(p)}: ${message_of(error)}\n`)
        return 2
    }
}

// ---- files and directories ----------------------------------------------------------------------------------------------------------

const mode_text = (kind: string): string => (kind === "dir" ? "drwxr-xr-x" : "-rw-r--r--")

const ls: program = async p => {
    const { flags, rest } = getopt(p.argv.slice(1))
    const all = !!flags.a || !!flags.A
    const long = !!flags.l
    const recursive = !!flags.R
    const targets = rest.length > 0 ? rest : ["."]
    let status = 0
    const files: { name: string, kind: string, size: number }[] = []
    const dirs: string[] = []
    for (const target of targets) {
        const info = await p.fs.stat(path_of(p, target))
        if (!info) {
            p.stderr.write(`ls: cannot access '${target}': No such file or directory\n`)
            status = 2
        } else if (info.kind === "dir" && !flags.d) dirs.push(target)
        else files.push({ name: target, kind: info.kind, size: info.size })
    }
    const show = (items: { name: string, kind: string, size: number }[]): string => {
        const shown = items.map(item => ({ ...item, label: item.name + (flags.F && item.kind === "dir" ? "/" : "") }))
        if (long) {
            const width = Math.max(1, ...shown.map(item => String(item.size).length))
            return shown.map(item => `${mode_text(item.kind)} 1 ${p.env.USER ?? "user"} ${p.env.USER ?? "user"} ${pad(String(item.size), width)} ${item.label}`).join("\n") + "\n"
        }
        if (flags[1] || !p.interactive) return shown.map(item => item.label).join("\n") + "\n"
        return shown.map(item => item.label).join("  ") + "\n"
    }
    if (files.length > 0) p.stdout.write(show(files))
    const walk = async (dir: string, heading: boolean): Promise<void> => {
        let entries: { name: string, kind: "file" | "dir" }[]
        try {
            entries = await p.fs.list(path_of(p, dir))
        } catch (error) {
            p.stderr.write(`ls: cannot open directory '${dir}': ${message_of(error)}\n`)
            status = 2
            return
        }
        if (all) entries = [{ name: ".", kind: "dir" }, { name: "..", kind: "dir" }, ...entries]
        else entries = entries.filter(entry => !entry.name.startsWith("."))
        entries.sort((a, b) => a.name.localeCompare(b.name))
        const items: { name: string, kind: string, size: number }[] = []
        for (const entry of entries) {
            const info = long ? await p.fs.stat(absolute(path_of(p, dir), entry.name)) : null
            items.push({ name: entry.name, kind: entry.kind, size: info?.size ?? 0 })
        }
        if (heading) p.stdout.write(`${dir}:\n`)
        if (items.length > 0) p.stdout.write(show(items))
        if (recursive) {
            for (const entry of entries) {
                if (entry.kind === "dir" && entry.name !== "." && entry.name !== "..") {
                    p.stdout.write("\n")
                    await walk(`${dir === "/" ? "" : dir}/${entry.name}`, true)
                }
            }
        }
    }
    let first = files.length === 0
    for (const dir of dirs) {
        if (!first) p.stdout.write("\n")
        first = false
        await walk(dir, targets.length > 1 || recursive)
    }
    return status
}

const cat: program = async p => {
    const { flags, rest } = getopt(p.argv.slice(1))
    const number = !!flags.n
    const files = rest.length > 0 ? rest : ["-"]
    let status = 0
    let line = 1
    const emit = (text: string): void => {
        if (!number) {
            p.stdout.write(text)
            return
        }
        const lines = text.split("\n")
        const last = lines.pop()!
        let out = lines.map(item => `${pad(String(line++), 6)}\t${item}\n`).join("")
        if (last !== "") out += `${pad(String(line++), 6)}\t${last}`
        p.stdout.write(out)
    }
    for (const file of files) {
        if (file === "-") {
            // a person typing: each line goes through as it comes
            for (;;) {
                const chunk = await p.stdin.read()
                if (chunk === null) break
                emit(chunk)
            }
            continue
        }
        const text = await read_file(p, file)
        if (text === null) status = 1
        else emit(text)
    }
    return status
}

const tac: program = async p => each_source(p, p.argv.slice(1), (_name, text) => p.stdout.write(lines_of(text).reverse().map(line => line + "\n").join("")))
const rev: program = async p => each_source(p, p.argv.slice(1), (_name, text) => p.stdout.write(lines_of(text).map(line => [...line].reverse().join("") + "\n").join("")))

const head: program = async p => {
    const { flags, rest, count } = getopt(p.argv.slice(1), "nc")
    const bytes = flags.c !== undefined ? Number(flags.c) : null
    const n = count ?? (flags.n !== undefined ? Number(flags.n) : 10)
    if (rest.length === 0 && bytes === null && n >= 0) {
        // from a pipe: stop reading as soon as there are enough lines, so `yes | head` ends
        let text = ""
        let wanted = n
        while (wanted > 0) {
            const chunk = await p.stdin.read()
            if (chunk === null) break
            text += chunk
            const parts = text.split("\n")
            const complete = parts.slice(0, -1)
            if (complete.length >= wanted) {
                p.stdout.write(complete.slice(0, wanted).map(line => line + "\n").join(""))
                return 0
            }
        }
        p.stdout.write(lines_of(text).map(line => line + "\n").join(""))
        return 0
    }
    return each_source(p, rest, (name, text, multiple) => {
        if (multiple) p.stdout.write(`==> ${name} <==\n`)
        if (bytes !== null) p.stdout.write(text.slice(0, bytes))
        else p.stdout.write(lines_of(text).slice(0, n).map(line => line + "\n").join(""))
    })
}

const tail: program = async p => {
    const { flags, rest, count } = getopt(p.argv.slice(1), "nc")
    const bytes = flags.c !== undefined ? Number(flags.c) : null
    const raw = flags.n !== undefined ? String(flags.n) : String(count ?? 10)
    const from_start = raw.startsWith("+")
    const n = Math.abs(Number(raw))
    return each_source(p, rest, (name, text, multiple) => {
        if (multiple) p.stdout.write(`==> ${name} <==\n`)
        if (bytes !== null) p.stdout.write(text.slice(-bytes))
        else {
            const lines = lines_of(text)
            p.stdout.write((from_start ? lines.slice(Math.max(0, n - 1)) : n === 0 ? [] : lines.slice(-n)).map(line => line + "\n").join(""))
        }
    })
}

const wc: program = async p => {
    const { flags, rest } = getopt(p.argv.slice(1))
    const any = flags.l || flags.w || flags.c || flags.m
    const show = { l: !any || !!flags.l, w: !any || !!flags.w, c: !any || !!flags.c || !!flags.m }
    const totals = [0, 0, 0]
    const rows: { name: string, values: number[] }[] = []
    const status = await each_source(p, rest, (name, text) => {
        const values = [text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0), (text.match(/\S+/g) ?? []).length, flags.m ? [...text].length : new TextEncoder().encode(text).length]
        values.forEach((value, index) => { totals[index] += value })
        rows.push({ name: rest.length > 0 ? name : "", values })
    })
    if (rest.length > 1) rows.push({ name: "total", values: totals })
    const width = Math.max(1, ...rows.flatMap(row => row.values.map(value => String(value).length)))
    for (const row of rows) {
        const columns = [show.l ? row.values[0] : null, show.w ? row.values[1] : null, show.c ? row.values[2] : null].filter((value): value is number => value !== null)
        p.stdout.write(columns.map(value => pad(String(value), rows.length === 1 && columns.length === 1 ? 0 : width)).join(" ") + (row.name ? ` ${row.name}` : "") + "\n")
    }
    return status
}

const mkdir: program = async p => {
    const { flags, rest } = getopt(p.argv.slice(1))
    if (rest.length === 0) return fail(p, "missing operand")
    let status = 0
    for (const name of rest) {
        const path = path_of(p, name)
        try {
            const existing = await p.fs.stat(path)
            if (existing) {
                if (flags.p && existing.kind === "dir") continue
                p.stderr.write(`mkdir: cannot create directory '${name}': File exists\n`)
                status = 1
                continue
            }
            if (flags.p) {
                let built = ""
                for (const part of path.split("/").filter(Boolean)) {
                    built += "/" + part
                    if (!(await p.fs.stat(built))) await p.fs.mkdir(built)
                }
            } else await p.fs.mkdir(path)
        } catch (error) {
            p.stderr.write(`mkdir: cannot create directory '${name}': ${message_of(error)}\n`)
            status = 1
        }
    }
    return status
}

const rmdir: program = async p => {
    let status = 0
    for (const name of p.argv.slice(1)) {
        try {
            const info = await p.fs.stat(path_of(p, name))
            if (!info) throw new Error("No such file or directory")
            if (info.kind !== "dir") throw new Error("Not a directory")
            if ((await p.fs.list(path_of(p, name))).length > 0) throw new Error("Directory not empty")
            await p.fs.remove(path_of(p, name))
        } catch (error) {
            p.stderr.write(`rmdir: failed to remove '${name}': ${message_of(error)}\n`)
            status = 1
        }
    }
    return status
}

const rm: program = async p => {
    const { flags, rest } = getopt(p.argv.slice(1))
    const recursive = !!flags.r || !!flags.R
    if (rest.length === 0 && !flags.f) return fail(p, "missing operand")
    let status = 0
    for (const name of rest) {
        const path = path_of(p, name)
        try {
            const info = await p.fs.stat(path)
            if (!info) {
                if (!flags.f) {
                    p.stderr.write(`rm: cannot remove '${name}': No such file or directory\n`)
                    status = 1
                }
                continue
            }
            if (path === "/") throw new Error("it is dangerous to operate recursively on '/'")
            if (info.kind === "dir" && !recursive) {
                p.stderr.write(`rm: cannot remove '${name}': Is a directory\n`)
                status = 1
                continue
            }
            await p.fs.remove(path, recursive)
        } catch (error) {
            p.stderr.write(`rm: cannot remove '${name}': ${message_of(error)}\n`)
            status = 1
        }
    }
    return status
}

const touch: program = async p => {
    let status = 0
    for (const name of p.argv.slice(1).filter(arg => !arg.startsWith("-"))) {
        try {
            const path = path_of(p, name)
            if (!(await p.fs.stat(path))) await p.fs.write(path, "", false)
        } catch (error) {
            p.stderr.write(`touch: cannot touch '${name}': ${message_of(error)}\n`)
            status = 1
        }
    }
    return status
}

async function copy_tree(p: proc_api, from: string, to: string, recursive: boolean): Promise<void> {
    const info = await p.fs.stat(from)
    if (!info) throw new Error("No such file or directory")
    if (info.kind === "file") {
        await p.fs.write(to, await p.fs.read(from), false)
        return
    }
    if (!recursive) throw new Error("-r not specified; omitting directory")
    if (!(await p.fs.stat(to))) await p.fs.mkdir(to)
    for (const entry of await p.fs.list(from)) await copy_tree(p, `${from}/${entry.name}`, `${to}/${entry.name}`, true)
}

async function copy_or_move(p: proc_api, move: boolean): Promise<number> {
    const { flags, rest } = getopt(p.argv.slice(1))
    const recursive = !!flags.r || !!flags.R || !!flags.a
    if (rest.length < 2) return fail(p, rest.length === 0 ? "missing file operand" : `missing destination file operand after '${rest[0]}'`)
    const target = rest[rest.length - 1]
    const target_path = path_of(p, target)
    const target_info = await p.fs.stat(target_path)
    const into_dir = target_info?.kind === "dir"
    if (rest.length > 2 && !into_dir) return fail(p, `target '${target}' is not a directory`)
    let status = 0
    for (const name of rest.slice(0, -1)) {
        const from = path_of(p, name)
        const to = into_dir ? `${target_path === "/" ? "" : target_path}/${base_name(from)}` : target_path
        try {
            if (from === to) throw new Error(`'${name}' and '${target}' are the same file`)
            if (move) {
                if (!(await p.fs.stat(from))) throw new Error("No such file or directory")
                await p.fs.rename(from, to)
            } else await copy_tree(p, from, to, recursive)
        } catch (error) {
            p.stderr.write(`${name_of(p)}: cannot ${move ? "move" : "copy"} '${name}' to '${target}': ${message_of(error)}\n`)
            status = 1
        }
    }
    return status
}

const cp: program = p => copy_or_move(p, false)
const mv: program = p => copy_or_move(p, true)

const basename: program = async p => {
    if (p.argv.length < 2) return fail(p, "missing operand")
    let name = base_name(p.argv[1])
    const suffix = p.argv[2]
    if (suffix && name.endsWith(suffix) && name !== suffix) name = name.slice(0, -suffix.length)
    p.stdout.write(name + "\n")
    return 0
}

const dirname: program = async p => {
    if (p.argv.length < 2) return fail(p, "missing operand")
    for (const name of p.argv.slice(1)) p.stdout.write(dir_name(name) + "\n")
    return 0
}

const realpath: program = async p => {
    for (const name of p.argv.slice(1).filter(arg => !arg.startsWith("-"))) p.stdout.write(path_of(p, name) + "\n")
    return 0
}

async function walk_find(p: proc_api, dir: string, shown: string, depth: number, visit: (path: string, shown: string, kind: "file" | "dir", depth: number) => Promise<boolean>, max: number): Promise<void> {
    let entries: { name: string, kind: "file" | "dir" }[]
    try {
        entries = await p.fs.list(dir)
    } catch {
        return
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
        const child = `${dir === "/" ? "" : dir}/${entry.name}`
        const label = `${shown === "/" ? "" : shown}/${entry.name}`
        const go = await visit(child, label, entry.kind, depth + 1)
        if (entry.kind === "dir" && go && depth + 1 < max) await walk_find(p, child, label, depth + 1, visit, max)
    }
}

const find: program = async p => {
    const args = p.argv.slice(1)
    const starts: string[] = []
    while (args.length > 0 && !args[0].startsWith("-") && args[0] !== "(" && args[0] !== "!") starts.push(args.shift()!)
    if (starts.length === 0) starts.push(".")
    let max = Infinity
    let min = 0
    const tests: ((name: string, kind: "file" | "dir") => boolean | Promise<boolean>)[] = []
    let print = true
    let delete_matches = false
    for (let i = 0; i < args.length; i++) {
        const arg = args[i]
        if (arg === "-name" || arg === "-iname") {
            const pattern = args[++i] ?? ""
            const ignore = arg === "-iname"
            tests.push(name => glob_match(ignore ? pattern.toLowerCase() : pattern, ignore ? name.toLowerCase() : name))
        } else if (arg === "-type") {
            const kind = args[++i]
            tests.push((_name, found) => (kind === "f" ? found === "file" : kind === "d" ? found === "dir" : true))
        } else if (arg === "-maxdepth") max = Number(args[++i])
        else if (arg === "-mindepth") min = Number(args[++i])
        else if (arg === "-empty") tests.push(async (name, found) => false && !!name && !!found)
        else if (arg === "-print") print = true
        else if (arg === "-delete") delete_matches = true
        else if (arg === "!" || arg === "-not") {
            const inner = tests.pop()
            if (inner) tests.push(async (name, kind) => !(await inner(name, kind)))
        } else if (arg === "-o" || arg === "-a" || arg === "(" || arg === ")") continue
        else return fail(p, `unknown predicate '${arg}'`)
    }
    let status = 0
    for (const start of starts) {
        const root = path_of(p, start)
        const info = await p.fs.stat(root)
        if (!info) {
            p.stderr.write(`find: '${start}': No such file or directory\n`)
            status = 1
            continue
        }
        const check = async (path: string, shown: string, kind: "file" | "dir", depth: number): Promise<boolean> => {
            if (depth < min) return true
            for (const item of tests) if (!(await item(base_name(path), kind))) return true
            if (print && !delete_matches) p.stdout.write(shown + "\n")
            if (delete_matches) {
                try {
                    await p.fs.remove(path, true)
                } catch (error) {
                    p.stderr.write(`find: cannot delete '${shown}': ${message_of(error)}\n`)
                    status = 1
                }
            }
            return true
        }
        if (min <= 0) await check(root, start, info.kind, 0)
        if (info.kind === "dir") await walk_find(p, root, start, 0, check, max)
    }
    return status
}

// ---- text filters -------------------------------------------------------------------------------------------------------------------

const grep: program = async p => {
    const { flags, rest } = getopt(p.argv.slice(1), "eABCm", ["regexp"])
    const patterns: string[] = []
    if (flags.e !== undefined) patterns.push(String(flags.e))
    if (flags.regexp !== undefined) patterns.push(String(flags.regexp))
    if (patterns.length === 0) {
        if (rest.length === 0) return fail(p, "usage: grep [OPTION]... PATTERNS [FILE]...") + 1
        patterns.push(rest.shift()!)
    }
    const extended = !!flags.E || !!flags.P
    const fixed = !!flags.F
    const ignore = !!flags.i
    let regexes: RegExp[]
    try {
        regexes = patterns.flatMap(pattern => pattern.split("\n")).map(pattern => {
            let source = fixed ? pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : make_regex(pattern, extended)
            if (flags.w) source = `\\b(?:${source})\\b`
            if (flags.x) source = `^(?:${source})$`
            return new RegExp(source, ignore ? "i" : "")
        })
    } catch (error) {
        return fail(p, message_of(error)) + 1
    }
    const invert = !!flags.v
    const files = rest.length > 0 ? rest : flags.r || flags.R ? ["."] : []
    const prefix = flags.H ? true : flags.h ? false : files.length > 1 || !!flags.r || !!flags.R
    const after = Number(flags.A ?? flags.C ?? 0)
    const before = Number(flags.B ?? flags.C ?? 0)
    const limit = flags.m !== undefined ? Number(flags.m) : Infinity
    let matched_any = false
    let status = 0
    const search = (name: string, text: string): void => {
        const lines = lines_of(text)
        let count = 0
        let last_printed = -1
        for (let index = 0; index < lines.length && count < limit; index++) {
            const hit = regexes.some(regex => regex.test(lines[index])) !== invert
            if (!hit) continue
            count++
            matched_any = true
            if (flags.q) return
            if (flags.l || flags.c) continue
            const from = Math.max(last_printed + 1, index - before)
            if (last_printed >= 0 && from > last_printed + 1 && (before > 0 || after > 0)) p.stdout.write("--\n")
            for (let at = from; at <= Math.min(lines.length - 1, index + after); at++) {
                if (at <= last_printed) continue
                const is_hit = at === index
                const sep = is_hit ? ":" : "-"
                let line = lines[at]
                if (flags.o && is_hit) {
                    const found: string[] = []
                    for (const regex of regexes) for (const piece of line.matchAll(new RegExp(regex.source, regex.flags + "g"))) if (piece[0] !== "") found.push(piece[0])
                    for (const piece of found) p.stdout.write(`${prefix ? name + sep : ""}${flags.n ? `${at + 1}${sep}` : ""}${piece}\n`)
                } else {
                    if (flags.o) continue
                    p.stdout.write(`${prefix ? name + sep : ""}${flags.n ? `${at + 1}${sep}` : ""}${line}\n`)
                }
                last_printed = at
                line = ""
            }
        }
        if (flags.c) p.stdout.write(`${prefix ? name + ":" : ""}${count}\n`)
        else if (flags.l && count > 0) p.stdout.write(name + "\n")
    }
    const recurse = !!flags.r || !!flags.R
    const run_file = async (name: string): Promise<void> => {
        const info = name === "-" ? { kind: "file" as const } : await p.fs.stat(path_of(p, name))
        if (!info) {
            p.stderr.write(`grep: ${name}: No such file or directory\n`)
            status = 2
            return
        }
        if (info.kind === "dir") {
            if (!recurse) {
                p.stderr.write(`grep: ${name}: Is a directory\n`)
                return
            }
            for (const entry of (await p.fs.list(path_of(p, name))).sort((a, b) => a.name.localeCompare(b.name))) await run_file(`${name === "/" ? "" : name}/${entry.name}`)
            return
        }
        const text = await read_file(p, name)
        if (text === null) status = 2
        else search(name === "-" ? "(standard input)" : name, text)
    }
    if (files.length === 0) search("(standard input)", await read_all(p))
    else for (const file of files) await run_file(file)
    return status !== 0 ? status : matched_any ? 0 : 1
}

function compare_keys(left: string, right: string, numeric: boolean, fold: boolean): number {
    if (numeric) {
        const a = Number.parseFloat(left)
        const b = Number.parseFloat(right)
        return (Number.isNaN(a) ? 0 : a) - (Number.isNaN(b) ? 0 : b)
    }
    if (fold) {
        left = left.toLowerCase()
        right = right.toLowerCase()
    }
    return left < right ? -1 : left > right ? 1 : 0
}

const sort: program = async p => {
    const { flags, rest } = getopt(p.argv.slice(1), "kto")
    const numeric = !!flags.n
    const fold = !!flags.f
    const separator = flags.t !== undefined ? String(flags.t) : null
    const key = flags.k !== undefined ? String(flags.k).split(",")[0].replace(/[a-z]+$/i, "") : null
    const field = (line: string): string => {
        if (!key) return line
        const parts = separator === null ? line.trim().split(/\s+/) : line.split(separator)
        return parts[Number(key) - 1] ?? ""
    }
    const all: string[] = []
    const status = await each_source(p, rest, (_name, text) => { all.push(...lines_of(text)) })
    all.sort((a, b) => {
        const result = compare_keys(field(a), field(b), numeric, fold) || compare_keys(a, b, false, false)
        return flags.r ? -result : result
    })
    const out = flags.u ? all.filter((line, index) => index === 0 || compare_keys(field(line), field(all[index - 1]), numeric, fold) !== 0) : all
    p.stdout.write(out.map(line => line + "\n").join(""))
    return status
}

const uniq: program = async p => {
    const { flags, rest } = getopt(p.argv.slice(1))
    return each_source(p, rest.slice(0, 1), (_name, text) => {
        const groups: { line: string, count: number }[] = []
        for (const line of lines_of(text)) {
            const last = groups[groups.length - 1]
            const same = last && (flags.i ? last.line.toLowerCase() === line.toLowerCase() : last.line === line)
            if (same) last.count++
            else groups.push({ line, count: 1 })
        }
        for (const group of groups) {
            if (flags.d && group.count < 2) continue
            if (flags.u && group.count > 1) continue
            p.stdout.write(`${flags.c ? pad(String(group.count), 7) + " " : ""}${group.line}\n`)
        }
    })
}

function parse_ranges(spec: string): ((index: number, total: number) => boolean) {
    const parts = spec.split(",").map(part => {
        const [from, to] = part.includes("-") ? part.split("-") : [part, part]
        return { from: from === "" ? 1 : Number(from), to: to === "" ? Infinity : Number(to) }
    })
    return index => parts.some(part => index >= part.from && index <= part.to)
}

const cut: program = async p => {
    const { flags, rest } = getopt(p.argv.slice(1), "dfcb")
    const spec = String(flags.f ?? flags.c ?? flags.b ?? "")
    if (spec === "") return fail(p, "you must specify a list of bytes, characters, or fields")
    const pick = parse_ranges(spec)
    const delimiter = flags.d !== undefined ? String(flags.d) : "\t"
    return each_source(p, rest, (_name, text) => {
        for (const line of lines_of(text)) {
            if (flags.f !== undefined) {
                if (!line.includes(delimiter)) {
                    if (!flags.s) p.stdout.write(line + "\n")
                    continue
                }
                p.stdout.write(line.split(delimiter).filter((_, index) => pick(index + 1, 0)).join(delimiter) + "\n")
            } else p.stdout.write([...line].filter((_, index) => pick(index + 1, 0)).join("") + "\n")
        }
    })
}

function expand_set(spec: string): string[] {
    const classes: Record<string, string> = {
        upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ", lower: "abcdefghijklmnopqrstuvwxyz", digit: "0123456789", alpha: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
        alnum: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789", space: " \t\n\r\f\v", blank: " \t", punct: "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~",
    }
    const out: string[] = []
    const text = unescape_text(spec).value
    for (let i = 0; i < text.length; i++) {
        const named = /^\[:([a-z]+):\]/.exec(text.slice(i))
        if (named && classes[named[1]]) {
            out.push(...classes[named[1]])
            i += named[0].length - 1
        } else if (text[i + 1] === "-" && i + 2 < text.length) {
            for (let code = text.charCodeAt(i); code <= text.charCodeAt(i + 2); code++) out.push(String.fromCharCode(code))
            i += 2
        } else out.push(text[i])
    }
    return out
}

const tr: program = async p => {
    const { flags, rest } = getopt(p.argv.slice(1))
    if (rest.length === 0) return fail(p, "missing operand")
    const set1 = expand_set(rest[0])
    const set2 = rest[1] !== undefined ? expand_set(rest[1]) : []
    const input = await read_all(p)
    const complement = !!flags.c || !!flags.C
    const in_set = (c: string): boolean => set1.includes(c) !== complement
    let out = ""
    let last = ""
    for (const c of input) {
        let result: string | null = c
        if (flags.d) {
            if (in_set(c)) result = null
        } else if (set2.length > 0 && in_set(c)) {
            const index = complement ? set2.length - 1 : set1.indexOf(c)
            result = set2[Math.min(index, set2.length - 1)]
        }
        if (result === null) continue
        if (flags.s && (set2.length > 0 ? set2 : set1).includes(result) && result === last) continue
        out += result
        last = result
    }
    p.stdout.write(out)
    return 0
}

const tee: program = async p => {
    const { flags, rest } = getopt(p.argv.slice(1))
    const text = await read_all(p)
    p.stdout.write(text)
    let status = 0
    for (const name of rest) {
        try {
            await p.fs.write(path_of(p, name), text, !!flags.a)
        } catch (error) {
            p.stderr.write(`tee: ${name}: ${message_of(error)}\n`)
            status = 1
        }
    }
    return status
}

const xargs: program = async p => {
    const { flags, rest } = getopt(p.argv.slice(1), "nIL")
    const command = rest.length > 0 ? rest : ["echo"]
    const input = await read_all(p)
    const items = flags.I !== undefined ? lines_of(input) : (input.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map(item => item.replace(/^(["'])(.*)\1$/, "$2"))
    if (items.length === 0) return 0
    let status = 0
    const groups: string[][] = flags.I !== undefined ? items.map(item => [item]) : flags.n !== undefined ? Array.from({ length: Math.ceil(items.length / Number(flags.n)) }, (_, index) => items.slice(index * Number(flags.n), (index + 1) * Number(flags.n))) : [items]
    for (const group of groups) {
        const argv = flags.I !== undefined ? command.map(part => part.split(String(flags.I)).join(group[0])) : [...command, ...group]
        const child = p.spawn(argv, { cwd: p.cwd, env: p.env, stdin: p.pipe(), stdout: p.stdout, stderr: p.stderr })
        const code = await child.done
        if (code !== 0) status = 123
    }
    return status
}

const seq: program = async p => {
    const { flags, rest } = getopt(p.argv.slice(1), "sf")
    const numbers = rest.map(Number)
    if (numbers.length === 0 || numbers.some(Number.isNaN)) return fail(p, "invalid argument")
    const [first, step, last] = numbers.length === 1 ? [1, 1, numbers[0]] : numbers.length === 2 ? [numbers[0], 1, numbers[1]] : numbers
    if (step === 0) return fail(p, "invalid zero increment")
    const separator = flags.s !== undefined ? String(flags.s) : "\n"
    const parts: string[] = []
    const width = flags.w ? Math.max(String(first).length, String(last).length) : 0
    for (let value = first; step > 0 ? value <= last : value >= last; value += step) {
        parts.push(String(Number(value.toFixed(10))).padStart(width, "0"))
        if (parts.length > 1_000_000) break
    }
    p.stdout.write(parts.join(separator) + "\n")
    return 0
}

const nl: program = async p => each_source(p, p.argv.slice(1), (_name, text) => p.stdout.write(lines_of(text).map((line, index) => `${pad(String(index + 1), 6)}\t${line}\n`).join("")))

const yes: program = async p => {
    const word = (p.argv.slice(1).join(" ") || "y") + "\n"
    const chunk = word.repeat(200)
    while (!p.signal.aborted && !p.stdout.ended) {
        p.stdout.write(chunk)
        await new Promise<void>(done => setTimeout(done, 0))
    }
    return 0
}

const sleep_program: program = async p => {
    const seconds = p.argv.slice(1).map(arg => (arg.endsWith("m") ? 60 : arg.endsWith("h") ? 3600 : 1) * Number.parseFloat(arg)).reduce((a, b) => a + b, 0)
    if (!p.argv[1] || Number.isNaN(seconds)) return fail(p, "missing operand")
    await sleep(p, seconds * 1000)
    return p.signal.aborted ? 130 : 0
}

const expr: program = async p => {
    const args = p.argv.slice(1)
    const value = (index: number): string => args[index] ?? ""
    if (args.length === 3) {
        const [a, op, b] = args
        const x = Number(a)
        const y = Number(b)
        const numbers = !Number.isNaN(x) && !Number.isNaN(y)
        let result: number | string
        switch (op) {
            case "+": result = x + y; break
            case "-": result = x - y; break
            case "*": result = x * y; break
            case "/": if (y === 0) return fail(p, "division by zero") + 1; result = Math.trunc(x / y); break
            case "%": if (y === 0) return fail(p, "division by zero") + 1; result = x % y; break
            case "=": result = Number(numbers ? x === y : a === b); break
            case "!=": result = Number(numbers ? x !== y : a !== b); break
            case "<": result = Number(numbers ? x < y : a < b); break
            case ">": result = Number(numbers ? x > y : a > b); break
            case "<=": result = Number(numbers ? x <= y : a <= b); break
            case ">=": result = Number(numbers ? x >= y : a >= b); break
            case ":": result = new RegExp(`^${make_regex(b, false)}`).exec(a)?.[1] ?? String(new RegExp(`^${make_regex(b, false)}`).exec(a)?.[0].length ?? 0); break
            default: return fail(p, "syntax error") + 1
        }
        p.stdout.write(`${result}\n`)
        return result === 0 || result === "" ? 1 : 0
    }
    if (value(0) === "length") {
        p.stdout.write(`${value(1).length}\n`)
        return 0
    }
    return fail(p, "syntax error") + 1
}

// ---- system and process information -------------------------------------------------------------------------------------------------

const date: program = async p => {
    const { rest } = getopt(p.argv.slice(1))
    const format = rest.find(arg => arg.startsWith("+"))?.slice(1)
    const now = new Date()
    const two = (n: number): string => String(n).padStart(2, "0")
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
    const spec = format ?? "%a %b %e %H:%M:%S %Z %Y"
    const day_of_year = Math.floor((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(now.getFullYear(), 0, 0)) / 86400000)
    const out = spec.replace(/%([a-zA-Z%])/g, (_, code: string) => {
        switch (code) {
            case "Y": return String(now.getFullYear())
            case "y": return two(now.getFullYear() % 100)
            case "m": return two(now.getMonth() + 1)
            case "d": return two(now.getDate())
            case "e": return String(now.getDate()).padStart(2, " ")
            case "H": return two(now.getHours())
            case "I": return two(now.getHours() % 12 || 12)
            case "M": return two(now.getMinutes())
            case "S": return two(now.getSeconds())
            case "p": return now.getHours() < 12 ? "AM" : "PM"
            case "A": return days[now.getDay()]
            case "a": return days[now.getDay()].slice(0, 3)
            case "B": return months[now.getMonth()]
            case "b": return months[now.getMonth()].slice(0, 3)
            case "j": return String(day_of_year).padStart(3, "0")
            case "s": return String(Math.floor(now.getTime() / 1000))
            case "Z": return Intl.DateTimeFormat().resolvedOptions().timeZone
            case "F": return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`
            case "T": return `${two(now.getHours())}:${two(now.getMinutes())}:${two(now.getSeconds())}`
            case "n": return "\n"
            case "%": return "%"
            default: return `%${code}`
        }
    })
    p.stdout.write(out + "\n")
    return 0
}

const env_program: program = async p => {
    for (const [name, value] of Object.entries(p.env).sort(([a], [b]) => a.localeCompare(b))) p.stdout.write(`${name}=${value}\n`)
    return 0
}

const printenv: program = async p => {
    const names = p.argv.slice(1)
    if (names.length === 0) return env_program(p)
    let status = 0
    for (const name of names) {
        if (p.env[name] === undefined) status = 1
        else p.stdout.write(p.env[name] + "\n")
    }
    return status
}

const whoami: program = async p => {
    p.stdout.write((p.env.USER ?? "user") + "\n")
    return 0
}

const hostname: program = async p => {
    p.stdout.write("jazu\n")
    return 0
}

const uname: program = async p => {
    const { flags } = getopt(p.argv.slice(1))
    p.stdout.write(flags.a ? "Jasouza desk 1.0 browser wasm-less x86_64 JavaScript\n" : "Jasouza\n")
    return 0
}

const clear: program = async p => {
    p.stdout.write("\x1b[2J\x1b[H")
    return 0
}

const ps: program = async p => {
    const { flags } = getopt(p.argv.slice(1))
    const list = p.list_procs().filter(item => item.running || flags.a)
    p.stdout.write(`${pad("PID", 5)} ${pad("PPID", 5)} STAT CMD\n`)
    for (const item of list.sort((a, b) => a.pid - b.pid)) p.stdout.write(`${pad(String(item.pid), 5)} ${pad(String(item.ppid), 5)} ${item.running ? "R" : "Z"}    ${item.argv.join(" ")}\n`)
    return 0
}

const kill: program = async p => {
    const args = p.argv.slice(1)
    let code = 143
    if (args[0] === "-l") {
        p.stdout.write("HUP INT QUIT KILL TERM\n")
        return 0
    }
    if (args[0]?.startsWith("-")) {
        const signal = args.shift()!.slice(1).replace(/^SIG/, "")
        code = { 9: 137, KILL: 137, 15: 143, TERM: 143, 2: 130, INT: 130, 1: 129, HUP: 129 }[signal as "9"] ?? 143
    }
    if (args.length === 0) return fail(p, "usage: kill [-9] pid...")
    let status = 0
    for (const arg of args) {
        const pid = Number(arg)
        if (!Number.isInteger(pid) || !p.kill(pid, code)) {
            p.stderr.write(`kill: (${arg}) - No such process\n`)
            status = 1
        }
    }
    return status
}

const which: program = async p => {
    let status = 0
    for (const name of p.argv.slice(1)) {
        if (p.commands.includes(name)) p.stdout.write(`/bin/${name}\n`)
        else status = 1
    }
    return status
}

const true_program: program = async () => 0
const false_program: program = async () => 1
const pwd: program = async p => {
    p.stdout.write(`${p.cwd}\n`)
    return 0
}

// ---- the table --------------------------------------------------------------------------------------------------------------------

export const utility_programs: Record<string, program> = {
    echo, printf, test, "[": test, pwd, ":": true_program, true: true_program, false: false_program,
    ls, cat, tac, rev, head, tail, wc, mkdir, rmdir, rm, touch, cp, mv, basename, dirname, realpath, find,
    grep, sort, uniq, cut, tr, tee, xargs, seq, nl, yes, sleep: sleep_program, expr,
    sed: sed_program, awk: awk_program,
    date, env: env_program, printenv, whoami, hostname, uname, clear, ps, kill, which,
}

export { normalize }
