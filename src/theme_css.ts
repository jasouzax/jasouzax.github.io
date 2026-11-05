import { readFileSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs"
import { dirname, join, resolve, basename, extname } from "node:path"
import { tmpdir } from "node:os"
import { pathToFileURL } from "node:url"
import * as sass from "sass"
import postcss from "postcss"
import { build as esbuild_build } from "esbuild"
import type { xml_node } from "./xml.ts"
import { child_nodes, where_of } from "./xml.ts"
import type { site_model } from "./model.ts"
import { report_error, report_warning, jazu_error } from "./diag.ts"
import { short_hash, split_list } from "./util.ts"
import { emit_font } from "./font_build.ts"

export type output_files = Map<string, Buffer | string>

export type theme_result = {
    name: string
    css: string
    js: string | null
    fonts: string[]
    colors: [string, string]
    background: string
    label: string
}

const api_mixins = `
@mixin mode_dark { @media (prefers-color-scheme: dark) { :root[data-mode="auto"] & { @content; } } :root[data-mode="dark"] & { @content; } }
@mixin mode_light { :root[data-mode="light"] & { @content; } @media (prefers-color-scheme: light) { :root[data-mode="auto"] & { @content; } } }
@mixin mode_auto { :root[data-mode="auto"] & { @content; } }
`

function palette_scss(node: xml_node): string {
    const lines: string[] = []
    for (const font of child_nodes(node, "font")) {
        for (const palette of child_nodes(font, "palette")) {
            const colors = split_list(palette.attrs.colors)
            lines.push(`$palette_${palette.attrs.mode}: (${colors.join(", ")}${colors.length === 1 ? "," : ""});`)
        }
    }
    return lines.join("\n")
}

function split_selectors(list: string): string[] {
    const parts: string[] = []
    let depth = 0
    let quote = ""
    let start = 0
    for (let index = 0; index < list.length; index++) {
        const char = list[index]
        if (quote) {
            if (char === quote && list[index - 1] !== "\\") quote = ""
            continue
        }
        if (char === `"` || char === "'") quote = char
        else if (char === "(" || char === "[") depth++
        else if (char === ")" || char === "]") depth--
        else if (char === "," && depth === 0) {
            parts.push(list.slice(start, index).trim())
            start = index + 1
        }
    }
    parts.push(list.slice(start).trim())
    return parts.filter(part => part.length > 0)
}

export function scope_selector(selector: string, theme: string): string {
    const root = `:root:where([data-theme="${theme}"])`
    if (selector.startsWith(":root")) return root + selector.slice(":root".length)
    if (/^html(?![\w-])/.test(selector)) return root + selector.slice("html".length)
    return `:where(:root[data-theme="${theme}"]) ${selector}`
}

function inside_keyframes(rule: postcss.Rule): boolean {
    let parent = rule.parent
    while (parent && parent.type !== "root") {
        if (parent.type === "atrule" && /keyframes$/.test((parent as postcss.AtRule).name)) return true
        parent = parent.parent
    }
    return false
}

export function scope_css(css: string, theme: string): string {
    const root = postcss.parse(css)
    root.walkRules(rule => {
        if (inside_keyframes(rule)) return
        rule.selector = split_selectors(rule.selector).map(selector => scope_selector(selector, theme)).join(", ")
    })
    return root.toString()
}

function rewrite_urls(css: string, base_dir: string, theme: string, files: output_files, model: site_model): string {
    const root = postcss.parse(css)
    root.walkDecls(decl => {
        decl.value = decl.value.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/g, (whole, quote: string, target: string) => {
            if (/^(data:|https?:|\/|#)/.test(target)) return whole
            const file = resolve(base_dir, target.split("?")[0])
            if (!existsSync(file)) {
                report_warning(model.diag, `theme ${theme}`, `missing asset ${target}`)
                return whole
            }
            const bytes = readFileSync(file)
            const name = `${basename(file, extname(file))}.${short_hash(bytes)}${extname(file)}`
            files.set(`assets/themes/${theme}/${name}`, bytes)
            return `url("/assets/themes/${theme}/${name}")`
        })
    })
    return root.toString()
}

function api_source(model: site_model, node: xml_node, data_scss: string): string {
    return `${data_scss}\n${palette_scss(node)}\n${api_mixins}`
}

function compile_scss(model: site_model, node: xml_node, style: xml_node, data_scss: string): { css: string, base_dir: string } {
    const base_dir = style.attrs.src ? dirname(resolve(dirname(node.file), style.attrs.src)) : dirname(node.file)
    const source = style.attrs.src ? readFileSync(resolve(dirname(node.file), style.attrs.src), "utf8") : `@use "jazu:api" as *;\n${style.text}`
    const api = api_source(model, node, data_scss)
    const importer: sass.Importer<"sync"> = {
        canonicalize: url => (url === "jazu:api" ? new URL("jazu:api") : null),
        load: () => ({ contents: api, syntax: "scss" }),
    }
    try {
        const result = sass.compileString(source, { importers: [importer], loadPaths: [base_dir], url: pathToFileURL(style.attrs.src ? resolve(dirname(node.file), style.attrs.src) : join(base_dir, "inline.scss")), style: model.mode === "production" ? "compressed" : "expanded", silenceDeprecations: ["global-builtin", "import", "mixed-decls"], quietDeps: true, logger: sass.Logger.silent })
        return { css: result.css, base_dir }
    } catch (error) {
        throw new jazu_error(`${where_of(style)}: ${(error as Error).message}`, 2)
    }
}

async function bundle_js(file: string): Promise<string> {
    const dir = mkdtempSync(join(tmpdir(), "jazu_js_"))
    const out = join(dir, "out.js")
    await esbuild_build({ entryPoints: [file], outfile: out, bundle: true, format: "iife", minify: true, logLevel: "silent" })
    const text = readFileSync(out, "utf8")
    rmSync(dir, { recursive: true, force: true })
    return text
}

export async function compile_theme(model: site_model, node: xml_node, data_scss: string, files: output_files): Promise<theme_result> {
    const name = node.attrs.name
    const url_dir = `/assets/themes/${name}`
    const parts: string[] = []
    const fonts: string[] = []
    for (const style of child_nodes(node, "style")) {
        const { css, base_dir } = compile_scss(model, node, style, data_scss)
        const rewritten = rewrite_urls(css, base_dir, name, files, model)
        parts.push(style.attrs.scope === "global" ? rewritten : scope_css(rewritten, name))
    }
    for (const font of child_nodes(node, "font")) {
        const font_files = new Map<string, Buffer>()
        const out = emit_font_to_map(model, font, name, font_files, url_dir)
        for (const [key, value] of font_files) files.set(key, value)
        parts.push(out.css)
        fonts.push(...out.preload)
    }
    const css_text = `@charset "UTF-8";\n` + parts.map(part => part.replace(/^\ufeff/, "").replace(/^@charset "[^"]*";\s*/, "")).join("\n")
    files.set(`assets/themes/${name}/${name}.${short_hash(css_text)}.css`, css_text)
    const preload = collect_preloads(css_text, split_list(node.attrs.preload))
    let js: string | null = null
    if (node.attrs.js) js = await emit_theme_js(model, node, files)
    const colors = (node.attrs.color ?? "#ffffff/#000000").split("/")
    return { name, css: `${url_dir}/${name}.${short_hash(css_text)}.css`, js, fonts: [...new Set([...fonts, ...preload])], colors: [colors[0], colors[1] ?? colors[0]], background: node.attrs.background ?? "", label: node.attrs.label ?? name }
}

function collect_preloads(css: string, families: string[]): string[] {
    const urls: string[] = []
    for (const family of families) {
        const face = new RegExp(`@font-face\\{[^}]*font-family:["']?${family}["']?[^}]*?url\\("?([^")]+\\.woff2)`).exec(css)
        if (face) urls.push(face[1])
    }
    return urls
}

function emit_font_to_map(model: site_model, font: xml_node, theme: string, files: output_files, url_dir: string): { css: string, preload: string[] } {
    const dir = mkdtempSync(join(tmpdir(), "jazu_out_"))
    const result = emit_font(model, font, dirname(font.file), dir, url_dir, model.config.font_formats)
    for (const name of readdirSync(dir)) files.set(`assets/themes/${theme}/${name}`, readFileSync(join(dir, name)))
    rmSync(dir, { recursive: true, force: true })
    return result
}

async function emit_theme_js(model: site_model, node: xml_node, files: output_files): Promise<string | null> {
    const file = resolve(dirname(node.file), node.attrs.js)
    if (!existsSync(file)) {
        report_error(model.diag, where_of(node), `theme js not found: ${node.attrs.js}`)
        return null
    }
    const result = await esbuild_build({
        entryPoints: [file], write: false, bundle: true, format: "iife", globalName: "jazu_theme_exports", minify: true,
        target: "es2020", logLevel: "silent",
        footer: { js: `window.jazu_theme_modules ||= {}; window.jazu_theme_modules[${JSON.stringify(node.attrs.name)}] = jazu_theme_exports;` }
    })
    const text = result.outputFiles[0].text
    const name = `assets/themes/${node.attrs.name}/${node.attrs.name}.${short_hash(text)}.js`
    files.set(name, text)
    return "/" + name
}
