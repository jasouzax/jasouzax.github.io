import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join, extname } from "node:path"
import type { site_model, page } from "../model.ts"
import { page_url } from "../model.ts"
import { configured_resource, published_resource } from "../resources.ts"
import { child_nodes } from "../xml.ts"
import { decode_char } from "../font_build.ts"
import type { output_files } from "../theme_css.ts"
import { esc_html, esc_attr, short_hash } from "../util.ts"
import { svg_to_png, build_ico, png_size } from "../raster.ts"
import { page_description } from "./seo_common.tsx"

export const cover_width = 1200
export const cover_height = 630

export type cover = {
    url: string
    width: number | null
    height: number | null
    type: string
    alt: string
    generated: boolean
}
export type brand = { background: string; foreground: string }

// ---------- the icon source ----------

export function icon_source(model: site_model): string | null {
    for (const name of ["icon", "signature", "favicon"] as const) {
        const file = configured_resource(model, name)
        if (file) return file
    }
    return null
}

export function has_icon(model: site_model): boolean {
    return icon_source(model) !== null
}

// The signature is drawn by SMIL (<animate attributeName="d"> from an empty path to the final shape). A rasteriser has no timeline, so it would
// draw nothing. Every animated path is frozen on its last keyframe, hidden-until-started becomes visible, and the animation elements go.
export function freeze_svg(svg: string): string {
    const frozen = svg.replace(/<path\b([^>]*)>([\s\S]*?)<\/path>/g, (whole, attrs: string, body: string) => {
        const animate = body.match(/<animate\b[^>]*attributeName="d"[^>]*>/)
        let next = attrs
        if (animate) {
            const values = animate[0].match(/\bvalues="([^"]*)"/)
            const last = values
                ? values[1]
                      .split(";")
                      .map((item) => item.trim())
                      .filter(Boolean)
                      .pop()
                : undefined
            const to = animate[0].match(/\bto="([^"]*)"/)
            const final = last ?? to?.[1]
            if (final)
                next = /\bd="/.test(next)
                    ? next.replace(/\bd="[^"]*"/, `d="${final}"`)
                    : `${next} d="${final}"`
        }
        next = next.replace(/\s+visibility="hidden"/, "")
        return `<path${next}/>`
    })
    return frozen
        .replace(/<(animate|set|animateTransform|animateMotion)\b[^>]*\/>/g, "")
        .replace(/<(animate|animateTransform|animateMotion)\b[^>]*>[\s\S]*?<\/\1>/g, "")
}

export type icon_art = { inner: string; view_box: [number, number, number, number] }

function number_list(text: string): number[] {
    return text
        .trim()
        .split(/[\s,]+/)
        .map(Number)
}

export function icon_art(model: site_model): icon_art | null {
    const file = icon_source(model)
    if (!file) return null
    const frozen = freeze_svg(readFileSync(file, "utf8"))
    const open = frozen.match(/<svg\b[^>]*>/)
    const close = frozen.lastIndexOf("</svg>")
    if (!open || close < 0) return null
    const tag = open[0]
    const box = tag.match(/\bviewBox="([^"]+)"/)
    let view_box: [number, number, number, number] = [0, 0, 100, 100]
    if (box) {
        const [x, y, w, h] = number_list(box[1])
        if ([x, y, w, h].every(Number.isFinite) && w > 0 && h > 0) view_box = [x, y, w, h]
    } else {
        const w = Number(tag.match(/\bwidth="([\d.]+)/)?.[1])
        const h = Number(tag.match(/\bheight="([\d.]+)/)?.[1])
        if (w > 0 && h > 0) view_box = [0, 0, w, h]
    }
    return { inner: frozen.slice(open.index! + tag.length, close), view_box }
}

function placed(
    art: icon_art,
    x: number,
    y: number,
    width: number,
    height: number,
    attrs: string,
    align: string = "xMidYMid"
): string {
    return `<svg x="${x}" y="${y}" width="${width}" height="${height}" viewBox="${art.view_box.join(" ")}" preserveAspectRatio="${align} meet" ${attrs}>${art.inner}</svg>`
}

export function brand_colors(model: site_model, theme_colors: [string, string]): brand {
    const given = model.config.seo.brand
    return {
        background: given.background || theme_colors[1],
        foreground: given.foreground || theme_colors[0]
    }
}

// A square tile. `fit` is the share of the tile the art may use (maskable icons keep to the inner 60%, the safe zone launchers crop to).
export function square_svg(art: icon_art, size: number, fit: number, colors: brand): string {
    const span = size * fit
    const pad = (size - span) / 2
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" fill="${esc_attr(colors.background)}"/>${placed(art, pad, pad, span, span, `color="${esc_attr(colors.foreground)}"`)}</svg>`
}

// The browser-tab icon has no tile: ink follows the tab's own scheme (dark ink on a light tab, light ink on a dark one).
export function adaptive_svg(art: icon_art, colors: brand): string {
    const style = `.ink{color:${colors.background}}@media (prefers-color-scheme:dark){.ink{color:${colors.foreground}}}`
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><style>${style}</style>${placed(art, 2, 2, 60, 60, `class="ink"`)}</svg>`
}

export async function icon_files(model: site_model, colors: brand, files: output_files): Promise<void> {
    const art = icon_art(model)
    if (!art) return
    files.set("icon.svg", adaptive_svg(art, colors))
    const png = (size: number, fit: number): Promise<Buffer> =>
        svg_to_png(square_svg(art, size, fit, colors), size)
    const ico = await Promise.all(
        [16, 32, 48].map(async (size) => ({ size, png: await png(size, size <= 16 ? 0.92 : 0.84) }))
    )
    files.set("favicon.ico", build_ico(ico))
    const favicon = configured_resource(model, "favicon")
    if (favicon) {
        const svg = freeze_svg(readFileSync(favicon, "utf8"))
        files.set("icon.svg", svg)
        files.set("favicon.ico", build_ico(await Promise.all([16, 32, 48].map(async size => ({ size, png: await svg_to_png(svg, size) })))))
    }
    files.set("apple-touch-icon.png", await png(180, 0.78))
    files.set("icons/icon-192.png", await png(192, 0.8))
    files.set("icons/icon-512.png", await png(512, 0.8))
    files.set("icons/icon-maskable-512.png", await png(512, 0.6))
}

// ---------- glyph text (the theme's own font, as paths) ----------

export type glyph_font = {
    cell: [number, number]
    glyphs: Map<number, { path: string; width: number }>
    signature: string
}
const fonts = new WeakMap<site_model, glyph_font | null>()

// The OG image is drawn with the default theme's <font> paths, so it needs no installed font and matches the site. Private-use icon glyphs are left out.
export function load_glyph_font(model: site_model): glyph_font | null {
    if (fonts.has(model)) return fonts.get(model)!
    const theme = model.themes.find((node) => node.attrs.name === model.config.default_theme)
    const font = theme
        ? child_nodes(theme, "font").find((node) => child_nodes(node, "sym").length > 0 && !node.attrs.src)
        : undefined
    let found: glyph_font | null = null
    if (font) {
        const [cell_w, cell_h] = (font.attrs.size ?? "60x100").split("x").map(Number)
        const glyphs = new Map<number, { path: string; width: number }>()
        for (const sym of child_nodes(font, "sym")) {
            const code = decode_char(model, sym)
            if (code === null || (code >= 0xe000 && code <= 0xf8ff) || code >= 0xf0000) continue
            if (child_nodes(sym, "layer").length > 0) continue
            glyphs.set(code, {
                path: sym.attrs.path ?? "",
                width: sym.attrs.width ? Number(sym.attrs.width) : cell_w
            })
        }
        if (glyphs.size > 0)
            found = { cell: [cell_w, cell_h], glyphs, signature: short_hash(JSON.stringify([...glyphs])) }
    }
    fonts.set(model, found)
    return found
}

function is_wide(code: number): boolean {
    return (
        (code >= 0x2e80 && code <= 0xd7af) ||
        (code >= 0xf900 && code <= 0xfaff) ||
        (code >= 0xff00 && code <= 0xffef)
    )
}

function clean_text(text: string): string {
    return text
        .replace(/\u2026/g, "...")
        .replace(/[\s\u00a0]+/g, " ")
        .trim()
}

function drawable(font: glyph_font | null, text: string): boolean {
    return font !== null && [...text].every((char) => font.glyphs.has(char.codePointAt(0)!))
}

function measure(font: glyph_font | null, text: string, size: number): number {
    const scale = size / (font?.cell[1] ?? 100)
    let total = 0
    for (const char of text) {
        const code = char.codePointAt(0)!
        const glyph = font?.glyphs.get(code)
        total += glyph ? glyph.width * scale : size * (is_wide(code) ? 1 : 0.58)
    }
    return total
}

export function wrap_text(
    font: glyph_font | null,
    text: string,
    size: number,
    max_width: number,
    max_lines: number
): string[] {
    const lines: string[] = []
    let line = ""
    const push_hard = (): void => {
        while (measure(font, line, size) > max_width && [...line].length > 1) {
            const chars = [...line]
            let take = chars.length - 1
            while (take > 1 && measure(font, chars.slice(0, take).join(""), size) > max_width) take--
            lines.push(chars.slice(0, take).join(""))
            line = chars.slice(take).join("")
        }
    }
    for (const word of clean_text(text).split(" ").filter(Boolean)) {
        const attempt = line ? `${line} ${word}` : word
        if (measure(font, attempt, size) <= max_width) {
            line = attempt
            continue
        }
        if (line) lines.push(line)
        line = word
        push_hard()
    }
    if (line) lines.push(line)
    if (lines.length <= max_lines) return lines
    const kept = lines.slice(0, max_lines)
    let last = kept[max_lines - 1]
    while ([...last].length > 1 && measure(font, `${last}...`, size) > max_width)
        last = [...last].slice(0, -1).join("").trimEnd()
    kept[max_lines - 1] = `${last}...`
    return kept
}

type canvas = { defs: Map<number, string> }

function draw_line(
    font: glyph_font | null,
    art: canvas,
    text: string,
    x: number,
    top: number,
    size: number,
    fill: string,
    opacity: number
): string {
    const attrs = `fill="${esc_attr(fill)}"${opacity < 1 ? ` fill-opacity="${opacity}"` : ""}`
    if (!font || !drawable(font, text)) {
        return `<text x="${x}" y="${round(top + size * 0.8)}" font-family="Noto Sans, DejaVu Sans, Helvetica, Arial, sans-serif" font-weight="700" font-size="${size}" ${attrs}>${esc_html(text)}</text>`
    }
    const scale = size / font.cell[1]
    const parts: string[] = []
    let cursor = x
    for (const char of text) {
        const code = char.codePointAt(0)!
        const glyph = font.glyphs.get(code)!
        if (glyph.path) {
            art.defs.set(code, `<path id="g${code}" d="${esc_attr(glyph.path)}"/>`)
            parts.push(
                `<use xlink:href="#g${code}" transform="translate(${round(cursor)} ${round(top)}) scale(${round(scale)})"/>`
            )
        }
        cursor += glyph.width * scale
    }
    return `<g ${attrs}>${parts.join("")}</g>`
}

function round(value: number): number {
    return Math.round(value * 100) / 100
}

// ---------- the cover (Open Graph / Twitter) image ----------

export type cover_art = { svg: string; hash: string }
const covers = new WeakMap<page, cover_art>()

function page_title_for_cover(model: site_model, page: page): string {
    return page.path === "/" ? model.config.site_name : page.name
}

export function cover_art(model: site_model, page: page, theme_colors: [string, string]): cover_art {
    const cached = covers.get(page)
    if (cached) return cached
    const font = load_glyph_font(model)
    const colors = brand_colors(model, theme_colors)
    const icon = icon_art(model)
    const canvas: canvas = { defs: new Map() }
    const left = 80
    const width = cover_width - left * 2
    const title = clean_text(page_title_for_cover(model, page))
    const info = clean_text(page_description(model, page))
    const host = new URL(model.config.base_url).host
    const footer = page.path === "/" ? host : `${host}${page_url(model, page)}`
    const top = 190
    const rule_y = cover_height - 104
    const room_for_title = rule_y - 40 - top
    const desc_size = 38
    const desc_pitch = Math.round(desc_size * 1.3)
    // the largest title size whose block still leaves room for two lines of description
    const sizes = [116, 100, 88, 76, 64]
    let size = sizes[sizes.length - 1]
    let title_lines = wrap_text(font, title, size, width, 2)
    for (const candidate of sizes) {
        const lines = wrap_text(font, title, candidate, width, 2)
        if (lines.length * candidate * 1.08 + (info ? 30 + 2 * desc_pitch : 0) <= room_for_title) {
            size = candidate
            title_lines = lines
            break
        }
    }
    const body: string[] = []
    body.push(`<rect width="${cover_width}" height="${cover_height}" fill="${esc_attr(colors.background)}"/>`)
    body.push(
        `<rect x="0" y="0" width="14" height="${cover_height}" fill="${esc_attr(colors.foreground)}" fill-opacity="0.9"/>`
    )
    if (icon) body.push(placed(icon, left, 64, 260, 86, `color="${esc_attr(colors.foreground)}"`, "xMinYMid"))
    let y = top
    title_lines.forEach((line) => {
        body.push(draw_line(font, canvas, line, left, y, size, colors.foreground, 1))
        y += size * 1.08
    })
    y += 30
    const room = Math.max(0, Math.floor((rule_y - 20 - y) / desc_pitch))
    const desc_lines = info ? wrap_text(font, info, desc_size, width, Math.min(3, room)) : []
    desc_lines.forEach((line) => {
        body.push(draw_line(font, canvas, line, left, y, desc_size, colors.foreground, 0.74))
        y += desc_pitch
    })
    body.push(
        `<rect x="${left}" y="${rule_y}" width="${width}" height="2" fill="${esc_attr(colors.foreground)}" fill-opacity="0.22"/>`
    )
    body.push(draw_line(font, canvas, footer, left, cover_height - 84, 30, colors.foreground, 0.74))
    const defs = canvas.defs.size ? `<defs>${[...canvas.defs.values()].join("")}</defs>` : ""
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${cover_width}" height="${cover_height}" viewBox="0 0 ${cover_width} ${cover_height}">${defs}${body.join("")}</svg>`
    const made = { svg, hash: short_hash(svg).slice(0, 8) }
    covers.set(page, made)
    return made
}

export function cover_slug(model: site_model, page: page): string {
    const base = page.path === "/" ? "home" : page.path.slice(1).replace(/\//g, "--")
    const clean = base.toLowerCase().replace(/[^a-z0-9._-]+/g, "_")
    return page.lang === model.config.default_language ? clean : `${page.lang}--${clean}`
}

const image_types: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".avif": "image/avif"
}

// A page may name its own cover (`cover="./x.png"` or a full URL); everything else gets a generated one.
export function cover_of(model: site_model, page: page, theme_colors: [string, string]): cover {
    const alt = `${page.name} | ${model.config.site_name}`
    const custom = page.node.attrs.cover
    if (custom) {
        const absolute = /^https?:\/\//.test(custom)
        const file = absolute ? null : published_resource(model, custom)
        const bytes =
            file && existsSync(file) && extname(file).toLowerCase() === ".png" ? readFileSync(file) : null
        const size = bytes ? png_size(bytes) : null
        return {
            url: absolute ? custom : model.config.base_url + (custom.startsWith("/") ? custom : `/${custom}`),
            width: size?.width ?? null,
            height: size?.height ?? null,
            type: image_types[extname(custom.split("?")[0]).toLowerCase()] ?? "",
            alt,
            generated: false
        }
    }
    const art = cover_art(model, page, theme_colors)
    return {
        url: `${model.config.base_url}/og/${cover_slug(model, page)}.png?v=${art.hash}`,
        width: cover_width,
        height: cover_height,
        type: "image/png",
        alt,
        generated: true
    }
}

export async function cover_files(
    model: site_model,
    theme_colors: [string, string],
    files: output_files
): Promise<void> {
    const dir = join(model.root, ".cache", "og")
    mkdirSync(dir, { recursive: true })
    const used = new Set<string>()
    for (const page of model.pages) {
        if (page.node.attrs.cover) continue
        const art = cover_art(model, page, theme_colors)
        const name = `${short_hash(art.svg)}.png`
        used.add(name)
        const cached = join(dir, name)
        let png: Buffer
        if (existsSync(cached)) png = readFileSync(cached)
        else {
            png = await svg_to_png(art.svg, cover_width)
            writeFileSync(cached, png)
        }
        files.set(`og/${cover_slug(model, page)}.png`, png)
    }
    for (const name of readdirSync(dir)) if (!used.has(name)) rmSync(join(dir, name), { force: true })
}
