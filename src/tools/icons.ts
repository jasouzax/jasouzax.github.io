/* CLI responsibilities for tools/icons. */
import { join, dirname } from "node:path"
import { rmSync, rmdirSync, mkdtempSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import { build_site } from "../../engine/build/build.ts"
import { new_diagnostics } from "../../shared/diag.ts"
import { add_icon, load_icons } from "../../engine/style/icons.ts"
import { load_site } from "../../engine/load/model.ts"
import type { site_model } from "../../engine/load/model.ts"
import { load_config } from "../../shared/config.ts"
import { child_nodes } from "../../shared/content/xml.ts"
import { decode_char } from "../../engine/style/font/build.ts"
import { cache_file } from "../../engine/build/cache.ts"
import type { flags } from "../config.ts"
import { collect_files } from "./pack.ts"

export function icons_command(root: string, words: string[]): void {
    const file = join(root, "config.json")
    if (words[0] === "list") {
        for (const [name, hex] of Object.entries(load_icons(file).icons)) console.log(`${hex}\t${name}`)
        return
    }
    if (words[0] === "add" && words[1]) {
        console.log(`registered ${words[1]} as U+${add_icon(file, words[1], words[2])}`)
        return
    }
    console.error("usage: icons list | icons add <name> [hex]")
    process.exitCode = 1
}

type icon_usage = { codepoints: Set<number>, names: Set<string> }

const pua_pattern = /[\u{E000}-\u{F8FF}\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/gu

function is_pua(codepoint: number): boolean {
    return (codepoint >= 0xe000 && codepoint <= 0xf8ff) || (codepoint >= 0xf0000 && codepoint <= 0xffffd) || (codepoint >= 0x100000 && codepoint <= 0x10fffd)
}

function registry_codepoint(value: unknown): number | null {
    if (typeof value !== "string") return null
    const match = value.trim().match(/^(?:U\+)?([0-9a-fA-F]{4,6})$/)
    if (!match) return null
    const codepoint = parseInt(match[1], 16)
    return is_pua(codepoint) ? codepoint : null
}

function hex_of(codepoint: number): string {
    return "U+" + codepoint.toString(16).toUpperCase().padStart(4, "0")
}

function hex_of_name(value: unknown): string {
    const codepoint = registry_codepoint(value)
    return codepoint === null ? "" : hex_of(codepoint)
}

// Collects PUA characters, css/js escapes and [name] tokens from one text file
function scan_icon_text(text: string, extension: string, usage: icon_usage, with_tokens: boolean): void {
    for (const match of text.matchAll(pua_pattern)) usage.codepoints.add(match[0].codePointAt(0)!)
    // generated html writes glyphs as numeric character references (for example &#xf015;)
    for (const match of text.matchAll(/&#(?:x([0-9a-fA-F]{1,6})|([0-9]{1,7}));/g)) {
        const codepoint = match[1] ? parseInt(match[1], 16) : parseInt(match[2], 10)
        if (is_pua(codepoint)) usage.codepoints.add(codepoint)
    }
    if (extension === ".css" || extension === ".scss") {
        for (const match of text.matchAll(/\\([0-9a-fA-F]{4,6})(?![0-9a-fA-F])/g)) {
            const codepoint = parseInt(match[1], 16)
            if (is_pua(codepoint)) usage.codepoints.add(codepoint)
        }
    }
    if ([".js", ".ts", ".json"].includes(extension)) {
        for (const match of text.matchAll(/\\u\{([0-9a-fA-F]{1,6})\}|\\u([0-9a-fA-F]{4})/g)) {
            const codepoint = parseInt(match[1] ?? match[2], 16)
            if (is_pua(codepoint)) usage.codepoints.add(codepoint)
        }
    }
    if (with_tokens) for (const match of text.matchAll(/\[([a-z][a-z0-9_-]*(?::[a-z0-9_-]+)?)\]/g)) usage.names.add(match[1])
}

function scan_icon_files(files: string[], usage: icon_usage, token_extensions: string[]): void {
    const text_extensions = [".html", ".json", ".css", ".js", ".scss", ".xml", ".ts", ".md", ".txt", ".svg"]
    for (const file of files) {
        const dot = file.lastIndexOf(".")
        const extension = dot < 0 ? "" : file.slice(dot).toLowerCase()
        if (!text_extensions.includes(extension)) continue
        scan_icon_text(readFileSync(file, "utf8"), extension, usage, token_extensions.includes(extension))
    }
}

// Source-only fallback, used when the temporary build cannot run (for example a native raster dependency is missing)
function scan_icon_sources(root: string, usage: icon_usage): void {
    const files: string[] = []
    for (const dir of ["."]) {
        const path = join(root, "content", dir)
        if (existsSync(path)) collect_files(path, files)
    }
    const src = join(root, "src")
    if (existsSync(src)) collect_files(src, files)
    scan_icon_files(files.filter(file => !file.endsWith(join("src", "cli.ts"))), usage, [".xml", ".json", ".ts", ".md", ".html", ".scss"])
}

export async function icons_audit(root: string, flags: flags): Promise<void> {
    const usage: icon_usage = { codepoints: new Set(), names: new Set() }
    const build_date = flags.date ? new Date(String(flags.date)) : new Date()
    const hashes = cache_file(root)
    const hashes_before = existsSync(hashes) ? readFileSync(hashes) : null
    const temp = mkdtempSync(join(root, "jazu_icons_"))
    let model: site_model | undefined
    let source = "temporary build"
    const unregistered = new Set<string>()
    try {
        // the real output directory (dist) is never written: the build goes to a temp directory that is deleted afterwards
        const result = await build_site({ root, out: temp, mode: "development", force: true, build_date, only_check: false })
        model = result.model
        for (const warning of result.diag.warnings) {
            const unknown = warning.match(/unknown icon token \[([^\]]+)\]/)
            if (unknown) unregistered.add(unknown[1])
        }
        const published = new Set([...model.resources.keys()].map(path => join(temp, path.replace(/^\/+/, ""))))
        const files = collect_files(temp).filter(file => !published.has(file))
        scan_icon_files(files, usage, [".html", ".json"])
    } catch (error) {
        console.warn(`warning: temporary build failed (${error instanceof Error ? error.message.split("\n")[0] : error}), scanning sources instead`)
        source = "source files"
        model = load_site(root, await load_config(root), new_diagnostics(), build_date, "development")
        scan_icon_sources(root, usage)
    } finally {
        rmSync(temp, { recursive: true, force: true })
        // the build also refreshes the incremental cache, put it back exactly as it was
        if (hashes_before) writeFileSync(hashes, hashes_before)
        else {
            rmSync(hashes, { force: true })
            try { rmdirSync(dirname(hashes)) } catch { /* not empty or missing */ }
        }
    }

    const registry = model.icons.icons
    const names_of = new Map<number, string[]>()
    const unassigned: string[] = []
    const unused: string[] = []
    for (const [name, value] of Object.entries(registry)) {
        const codepoint = registry_codepoint(value)
        if (codepoint === null) unassigned.push(name)
        else names_of.set(codepoint, [...(names_of.get(codepoint) ?? []), name])
        if (!usage.names.has(name) && (codepoint === null || !usage.codepoints.has(codepoint))) unused.push(name)
    }

    console.log(`icons audit (usage read from ${source}, ${Object.keys(registry).length} registered icons)`)
    // tokens the site uses that the registry does not know have no codepoint either
    const unknown_names = [...unregistered].filter(name => !(name in registry))
    console.log(`\n\x1b[33munassigned icons (no private use codepoint):\x1b[0m ${unassigned.length + unknown_names.length}`)
    for (const name of unassigned) console.log(`  [${name}]\t${JSON.stringify(registry[name] ?? "")}`)
    for (const name of unknown_names) console.log(`  [${name}]\t(used by the site but not in the registry)`)

    // icons that share a codepoint with at least one other icon (values like "f755" and "F755" count as the same)
    const duplicates = [...names_of.entries()].filter(([, names]) => names.length > 1).sort((a, b) => a[0] - b[0])
    console.log(`\n\x1b[33mduplicate icons (same codepoint as another icon):\x1b[0m ${duplicates.reduce((sum, [, names]) => sum + names.length, 0)}`)
    for (const [codepoint, names] of duplicates) {
        for (const name of names) console.log(`  [${name}]\t${hex_of(codepoint)}\talso ${names.filter(other => other !== name).map(other => `[${other}]`).join(" ")}`)
    }

    const wanted = new Set<number>([...names_of.keys(), ...[...usage.codepoints]])
    console.log("\n\x1b[33mmissing icons (theme font has no glyph for the codepoint):\x1b[0m")
    for (const theme of model.themes) {
        for (const font of child_nodes(theme, "font")) {
            const label = `theme "${theme.attrs.name}" font "${font.attrs.name}"`
            if (font.attrs.src) {
                console.log(`  ${label}: prebuilt font file, glyphs not inspected`)
                continue
            }
            const have = new Set<number>()
            for (const sym of child_nodes(font, "sym")) {
                const codepoint = decode_char(model, sym)
                if (codepoint !== null) have.add(codepoint)
            }
            const gone = [...wanted].filter(codepoint => !have.has(codepoint)).sort((a, b) => a - b)
            console.log(`  ${label}: ${gone.length}`)
            for (const codepoint of gone) console.log(`    ${hex_of(codepoint)}\t${names_of.get(codepoint)?.map(name => `[${name}]`).join(" ") ?? "(not in registry)"}`)
        }
    }
    if (model.themes.every(theme => child_nodes(theme, "font").length === 0)) console.log("  no theme declares a font")

    console.log(`\n\x1b[33munused icons (not used by the website):\x1b[0m ${unused.length}`)
    for (const name of unused) console.log(`  [${name}]\t${hex_of_name(registry[name])}`)
}
