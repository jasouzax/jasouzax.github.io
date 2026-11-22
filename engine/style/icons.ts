/* Canonical Material Design token map; public config is its checked projection. */
import { readFileSync, writeFileSync } from "node:fs"
import { jazu_error } from "../../shared/diag.ts"

const material = JSON.parse(readFileSync(new URL("./icons/material.json", import.meta.url), "utf8")) as { icons: Record<string, string>, glyphs: Record<string, { codepoint: string }> }
export const material_icons: Record<string, string> = Object.fromEntries(Object.entries(material.icons).map(([token, name]) => [token, material.glyphs[name].codepoint]))

export function icon_map(configured: Record<string, string>): Record<string, string> {
    for (const [token, codepoint] of Object.entries(material_icons)) if (configured[token] && configured[token].toUpperCase() !== codepoint) throw new jazu_error(`icon ${token} must use Material Design codepoint ${codepoint}`, 1)
    return { ...configured, ...material_icons }
}

export type icon_registry = {
    start: string
    icons: Record<string, string>
}

export function load_icons(file: string): icon_registry {
    const data = JSON.parse(readFileSync(file, "utf8"))
    return { start: data.start ?? "E000", icons: icon_map(data.icons ?? {}) }
}

export function add_icon(file: string, name: string, codepoint?: string): string {
    const registry = load_icons(file)
    if (registry.icons[name]) throw new jazu_error(`icon ${name} already registered`, 1)
    const hex = codepoint ?? material.glyphs[name.replaceAll("_", "-")]?.codepoint
    if (!hex || !Object.values(material.glyphs).some(glyph => glyph.codepoint === hex.toUpperCase())) throw new jazu_error("Choose a glyph from the pinned Material Design subset; update its metadata and both theme fonts to add a new glyph", 1)
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
