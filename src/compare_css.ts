import { readFileSync } from "node:fs"
import postcss, { type ChildNode } from "postcss"

const theme_name = process.argv[4] ?? "default"
const scope_pattern = new RegExp(`:root:where\\(\\[data-theme="${theme_name}"\\]\\)|:where\\(:root\\[data-theme="${theme_name}"\\]\\)\\s*`, "g")

function normalize_selector(selector: string, scoped: boolean): string {
    const base = scoped ? selector.replace(scope_pattern, (match: string) => (match.startsWith(":root") ? ":root" : "")) : selector
    return base.replace(/(^|,)html(?![\w-])/g, "$1:root").replace(/\s+/g, " ").replace(/\s*([>+~,])\s*/g, "$1").trim()
}

function normalize_value(value: string): string {
    return value
        .replace(/rgba\(0,\s*0,\s*0,\s*0\)/g, "transparent")
        .replace(/(^|[^\d])0\./g, "$1.")
        .replace(/\s*([*/])\s*/g, "$1")
        .replace(/\s+/g, " ")
        .replace(/\s*,\s*/g, ",")
        .replace(/[\ue000-\uf8ff]/g, (char: string) => "\\" + char.charCodeAt(0).toString(16))
        .trim()
}

function load_rules(file: string, scoped: boolean): Map<string, string[]> {
    const rules = new Map<string, string[]>()
    postcss.parse(readFileSync(file, "utf8")).walkRules((rule) => {
        const context: string[] = []
        for (let parent = rule.parent; parent && parent.type !== "root"; parent = parent.parent) {
            if (parent.type === "atrule") context.unshift(`@${parent.name} ${parent.params.replace(/\s+/g, "")}`)
        }
        const key = `${context.join("|")}|${normalize_selector(rule.selector, scoped)}`
        const declarations: string[] = []
        rule.each((node: ChildNode) => { if (node.type === "decl") declarations.push(`${node.prop}:${normalize_value(node.value)}`) })
        rules.set(key, [...(rules.get(key) ?? []), declarations.join(";")])
    })
    return rules
}

const [original_file, generated_file] = process.argv.slice(2)
if (!original_file || !generated_file) {
    console.error("usage: node src/compare_css.ts <original.css> <generated.css> [theme_name]")
    process.exit(2)
}
const original = load_rules(original_file, false)
const generated = load_rules(generated_file, true)
const missing = [...original.keys()].filter((key) => !generated.has(key))
const extra = [...generated.keys()].filter((key) => !original.has(key))
const changed = [...original.keys()].filter((key) => generated.has(key) && original.get(key)!.join("#") !== generated.get(key)!.join("#"))
console.log(`rules: original ${original.size}, generated ${generated.size}`)
console.log(`missing ${missing.length}, changed ${changed.length}, extra ${extra.length}`)
for (const [label, list] of [["missing", missing], ["changed", changed], ["extra", extra]] as [string, string[]][]) {
    for (const key of list.slice(0, 25)) console.log(`${label}: ${key}`)
}
process.exitCode = missing.length > 0 || changed.length > 0 ? 1 : 0
