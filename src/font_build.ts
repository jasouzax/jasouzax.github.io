import { mkdirSync, readFileSync, writeFileSync, copyFileSync, mkdtempSync, rmSync } from "node:fs"
import { join, dirname } from "node:path"
import { tmpdir } from "node:os"
import type { xml_node } from "./xml.ts"
import { child_nodes, where_of } from "./xml.ts"
import type { site_model } from "./model.ts"
import { jazu_error } from "./diag.ts"
import { report_error } from "./diag.ts"
import { short_hash, split_list } from "./util.ts"
import { encode_font } from "./font/binary.ts"

export type font_output = { family: string, files: Record<string, string>, role: string }

type sym_job = { codepoint: number, path: string, width: number | null, layers: { path: string, color: string }[] }

export function decode_char(model: site_model, node: xml_node): number | null {
    const raw = node.attrs.char
    const token = raw.match(/^\[([a-z][a-z0-9_]*(?::[a-z0-9_-]+)?)\]$/)
    if (token) {
        const hex = model.icons.icons[token[1]]
        return hex ? parseInt(hex, 16) : null
    }
    if (/^[0-9a-fA-F]{4,6}$/.test(raw) && raw.length > 1) return parseInt(raw, 16)
    if ([...raw].length === 1) return raw.codePointAt(0)!
    return null
}

function sym_jobs(model: site_model, font: xml_node): sym_job[] {
    const seen = new Set<number>()
    const jobs: sym_job[] = []
    for (const sym of child_nodes(font, "sym")) {
        const codepoint = decode_char(model, sym)
        if (codepoint === null) {
            report_error(model.diag, where_of(sym), `cannot decode char "${sym.attrs.char}" (use one character, 4-6 hex digits, or a registered [token])`)
            continue
        }
        if (seen.has(codepoint)) {
            report_error(model.diag, where_of(sym), `duplicate codepoint U+${codepoint.toString(16)}`)
            continue
        }
        seen.add(codepoint)
        const layers = child_nodes(sym, "layer").map(layer => ({ path: layer.attrs.path, color: layer.attrs.color ?? "0" }))
        jobs.push({ codepoint, path: sym.attrs.path ?? "", width: sym.attrs.width ? Number(sym.attrs.width) : null, layers })
    }
    return jobs
}

function palettes_of(font: xml_node): { light: string[], dark: string[] } {
    const palettes = { light: ["#000000"], dark: [] as string[] }
    for (const palette of child_nodes(font, "palette")) palettes[palette.attrs.mode === "dark" ? "dark" : "light"] = split_list(palette.attrs.colors)
    return palettes
}

export function build_font(model: site_model, font: xml_node, formats: string[]): { dir: string, files: Record<string, string> } {
    const dir = mkdtempSync(join(tmpdir(), "jazu_font_"))
    const [width, height] = (font.attrs.size ?? "60x100").split("x").map(Number)
    const job = { name: font.attrs.name, out_dir: dir, epoch: Math.floor(model.build_date.getTime() / 1000), cell: [width, height], formats, palettes: palettes_of(font), syms: sym_jobs(model, font) }
    try {
        const files: Record<string, string> = {}
        for (const [format, bytes] of encode_font(job)) {
            const name = `${job.name}.${format === "colrv0" ? "colrv0.woff2" : format}`
            writeFileSync(join(dir, name), bytes); files[format] = name
        }
        return { dir, files }
    } catch (error) {
        rmSync(dir, { recursive: true, force: true })
        throw new jazu_error(`font ${job.name} failed: ${error instanceof Error ? error.message : error}`, 3)
    }
}

export function emit_font(model: site_model, font: xml_node, theme_dir: string, out_dir: string, url_dir: string, formats: string[]): { css: string, preload: string[] } {
    mkdirSync(out_dir, { recursive: true })
    const src = font.attrs.src
    if (src) return emit_prebuilt(font, join(dirname(font.file), src), out_dir, url_dir)
    const built = build_font(model, font, formats)
    const urls: Record<string, string> = {}
    try { for (const [format, name] of Object.entries(built.files)) {
        const bytes = readFileSync(join(built.dir, name))
        const out_name = name.replace(/(\.[a-z0-9]+)$/, `.${short_hash(bytes)}$1`)
        copyFileSync(join(built.dir, name), join(out_dir, out_name))
        urls[format] = `${url_dir}/${out_name}`
    } } finally { rmSync(built.dir, { recursive: true, force: true }) }
    return { css: font_face_css(font.attrs.name, urls), preload: urls.colrv0 ? [urls.colrv0] : urls.woff2 ? [urls.woff2] : [] }
}

function emit_prebuilt(font: xml_node, file: string, out_dir: string, url_dir: string): { css: string, preload: string[] } {
    const bytes = readFileSync(file)
    const name = `${font.attrs.name}.${short_hash(bytes)}.woff2`
    copyFileSync(file, join(out_dir, name))
    const url = `${url_dir}/${name}`
    return { css: `@font-face{font-family:"${font.attrs.name}";font-display:swap;src:url("${url}") format("woff2")}`, preload: [url] }
}

export function font_face_css(family: string, urls: Record<string, string>): string {
    const base = urls.colrv0 ?? urls.woff2
    const legacy = urls.woff ? `,url("${urls.woff}") format("woff")` : ""
    const first = `@font-face{font-family:"${family}";font-display:swap;src:url("${base}") format("woff2")${legacy}}`
    const palette = urls.colrv1 ? `@supports font-tech(color-COLRv1){@font-face{font-family:"${family}";font-display:swap;src:url("${urls.colrv1}") format("woff2")}}` : ""
    return first + palette
}
