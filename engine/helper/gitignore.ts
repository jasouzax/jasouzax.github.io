import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

// A small, git-independent implementation of .gitignore semantics, so packaging works without git or a .git folder.
// Supported: comments, blank lines, escapes (\# \! \ ), negation (!), directory-only (trailing /), anchoring (leading
// or inner /), *, ?, [...] classes and ** forms. Deeper .gitignore files override shallower ones; the last match wins;
// files inside an ignored directory can never be re-included (same as git).
export type ignore_rule = { base: string, regex: RegExp, negate: boolean, directory_only: boolean }

function glob_to_regex(pattern: string, anchored: boolean): RegExp {
    let body = ""
    for (let i = 0; i < pattern.length; i++) {
        const char = pattern[i]
        if (char === "\\" && i + 1 < pattern.length) { body += pattern[++i].replace(/[.*+?^${}()|[\]\\/]/g, "\\$&"); continue }
        if (char === "*") {
            if (pattern.startsWith("**/", i) && (i === 0 || pattern[i - 1] === "/")) { body += "(?:.*/)?"; i += 2; continue }
            if (pattern[i + 1] === "*") { while (pattern[i + 1] === "*") i++; body += ".*"; continue }
            body += "[^/]*"
            continue
        }
        if (char === "/" && pattern.startsWith("/**", i) && i + 3 === pattern.length) { body += "/.+"; break }
        if (char === "?") { body += "[^/]"; continue }
        if (char === "[") {
            const end = pattern.indexOf("]", i + 2)
            if (end > 0) {
                let set = pattern.slice(i + 1, end)
                if (set[0] === "!") set = "^" + set.slice(1)
                body += `[${set.replace(/\\/g, "\\\\")}]`
                i = end
                continue
            }
        }
        body += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    }
    return new RegExp(anchored ? `^${body}$` : `(?:^|/)${body}$`)
}

export function parse_ignore(text: string, base: string): ignore_rule[] {
    const rules: ignore_rule[] = []
    for (const raw of text.split(/\r?\n/)) {
        let line = raw.replace(/(?<!\\)\s+$/, "")
        if (!line || line.startsWith("#")) continue
        const negate = line.startsWith("!")
        if (negate) line = line.slice(1)
        if (line.startsWith("\\#") || line.startsWith("\\!")) line = line.slice(1)
        const directory_only = line.endsWith("/")
        if (directory_only) line = line.slice(0, -1)
        if (!line) continue
        const anchored = line.includes("/")
        if (line.startsWith("/")) line = line.slice(1)
        rules.push({ base, regex: glob_to_regex(line, anchored), negate, directory_only })
    }
    return rules
}

export function is_ignored(path: string, directory: boolean, rules: ignore_rule[]): boolean {
    let ignored = false
    for (const rule of rules) {
        if (rule.base && !path.startsWith(`${rule.base}/`)) continue
        if (rule.directory_only && !directory) continue
        if (rule.regex.test(rule.base ? path.slice(rule.base.length + 1) : path)) ignored = !rule.negate
    }
    return ignored
}

// Always skipped, regardless of any .gitignore: version-control data and installed dependencies.
const always_skipped = new Set([".git", "node_modules"])

export function collect_unignored(root: string, skip: (path: string) => boolean = () => false): string[] {
    const found: string[] = []
    const walk = (dir: string, relative_dir: string, inherited: ignore_rule[]): void => {
        const file = join(dir, ".gitignore")
        const rules = existsSync(file) ? [...inherited, ...parse_ignore(readFileSync(file, "utf8"), relative_dir)] : inherited
        for (const name of readdirSync(dir).sort()) {
            if (always_skipped.has(name)) continue
            const path = join(dir, name)
            const relative_path = relative_dir ? `${relative_dir}/${name}` : name
            const link = lstatSync(path)
            if (link.isSymbolicLink() && statSync(path).isDirectory()) continue
            const directory = statSync(path).isDirectory()
            if (is_ignored(relative_path, directory, rules) || skip(path)) continue
            if (directory) walk(path, relative_path, rules)
            else found.push(path)
        }
    }
    walk(root, "", [])
    return found
}
