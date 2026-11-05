import { readFileSync, writeFileSync } from "node:fs"
import { jazu_error } from "./diag.ts"

export type icon_registry = {
    start: string
    icons: Record<string, string>
}

export function load_icons(file: string): icon_registry {
    const data = JSON.parse(readFileSync(file, "utf8"))
    return { start: data.start ?? "E000", icons: data.icons ?? {} }
}

export function next_codepoint(registry: icon_registry): string {
    const used = Object.values(registry.icons).map(hex => parseInt(hex, 16))
    const top = Math.max(parseInt(registry.start, 16) - 1, ...used)
    return (top + 1).toString(16).toUpperCase()
}

export function add_icon(file: string, name: string, codepoint?: string): string {
    const registry = load_icons(file)
    if (registry.icons[name]) throw new jazu_error(`icon ${name} already registered`, 1)
    const hex = codepoint ?? next_codepoint(registry)
    registry.icons[name] = hex.toUpperCase()
    const data = JSON.parse(readFileSync(file, "utf8"))
    writeFileSync(file, JSON.stringify({ ...data, icons: registry.icons }, null, 4) + "\n")
    return hex
}

export function expand_tokens(text: string, registry: icon_registry, on_unknown: (name: string) => void): string {
    return text.replace(/\[([a-z][a-z0-9_]*(?::[a-z0-9_-]+)?)\]/g, (whole, name: string) => {
        const hex = registry.icons[name]
        if (!hex) {
            on_unknown(name)
            return whole
        }
        return String.fromCodePoint(parseInt(hex, 16))
    })
}

export function icon_chars(value: string | undefined, registry: icon_registry, on_unknown: (name: string) => void): string {
    if (!value) return ""
    return expand_tokens(value, registry, on_unknown)
}
