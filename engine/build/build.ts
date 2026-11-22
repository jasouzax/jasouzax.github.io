import { bundle_runtime } from "./bundle.ts"
import { disk_hash, write_files } from "./write.ts"
import { writeFileSync, readFileSync, existsSync, statSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import { transform } from "esbuild"
import { load_config } from "../../shared/config.ts"
import type { diagnostics } from "../../shared/diag.ts"
import { new_diagnostics, fail_on_errors } from "../../shared/diag.ts"
import type { site_model, page } from "../load/model.ts"
import { load_site, page_url, ui_text } from "../load/model.ts"
import { parse_xml } from "../../shared/content/xml.ts"
import { validate_roots } from "../../shared/content/schema.ts"
import { build_expertise, scss_data } from "../tags/expertise/model.ts"
import type { expertise_model } from "../tags/expertise/model.ts"
import type { output_files } from "../style/theme.ts"
import { compile_theme, compile_inline_layout } from "../style/theme.ts"
import { skeleton_css } from "../style/skeleton.ts"
import type { page_assets, theme_assets } from "../tags/page.tsx"
import { render_page, background_html } from "../tags/page.tsx"
import { sitemap_xml, robots_txt, headers_file, redirects_file, inline_script_hash, nav_index } from "../seo/head.tsx"
import { manifest_json, security_txt } from "../seo/files.tsx"
import { llms_txt, llms_full_txt } from "../seo/llms.tsx"
import { icon_files, cover_files, brand_colors } from "../seo/cover.tsx"
import { load_cache, save_cache } from "./cache.ts"
import { page_hash, shared_hash } from "./graph.ts"
import { esc_attr, unique } from "../../shared/util.ts"
import { jazu_error } from "../../shared/diag.ts"
import { emit_page_styles } from "../style/page.tsx"
import { output_directory, output_file } from "../../shared/paths.ts"
import { serialize, type serialized_node } from "../../shared/vnode/vnode.tsx"
import { compile_plugins } from "../tags/plugin.ts"
import { pwa_files } from "../routes/sw.js.ts"
import { rss_xml } from "../routes/blogs/rss.xml.tsx"
import { atom_xml } from "../routes/blogs/atom.xml.tsx"
import { feed_path } from "../seo/rss.ts"

export type build_options = {
    root: string
    out: string
    mode: "production" | "development"
    force: boolean
    build_date: Date
    only_check: boolean
    base_url?: string
}

export type build_result = {
    model: site_model
    diag: diagnostics
    written: string[]
    skipped: number
    pages: number
}

// Pages every site has and nobody writes: a sitemap in each language, and one 404. A static host serves a single 404.html whatever
// the language of the missing URL, so that page speaks every configured language (the default first).
function synthesize(model: site_model): void {
    const languages = Object.keys(model.config.languages)
    const sources: { lang: string, xml: string }[] = []
    for (const lang of languages) {
        if (model.pages.some(page => page.path === "/sitemap" && page.lang === lang)) continue
        const name = esc_attr(ui_text(model, lang, "sitemap"))
        const info = esc_attr(ui_text(model, lang, "sitemap_info"))
        sources.push({ lang, xml: `<page path="/sitemap" lang="${lang}" name="${name}" info="${info}" noindex="true" menu="false"><hero name="${name}" info="${info}"/></page>` })
    }
    if (!model.pages.some(page => page.path === "/404")) {
        const lang = model.config.default_language
        const name = esc_attr(unique(languages.map(code => ui_text(model, code, "not_found"))).join(" / "))
        const info = esc_attr(languages.map(code => ui_text(model, code, "not_found_info")).join(" "))
        sources.push({ lang, xml: `<page path="/404" name="${name}" info="${info}" noindex="true" menu="false"><hero name="${name}" info="${info}"/></page>` })
    }
    for (const source of sources) {
        const roots = parse_xml(source.xml, "<generated>")
        validate_roots(roots, model.diag)
        const node = roots[0]
        node.children[0].children = model.pages.filter(page => page.lang === source.lang && page.node.attrs.menu !== "false").map(page => ({
            tag: "item", attrs: { name: page.name, text: page.info, link: page.path }, children: [], text: "", line: 0, file: "<generated>", parent: node.children[0],
        }))
        model.pages.push({ path: node.attrs.path, lang: source.lang, name: node.attrs.name, info: node.attrs.info ?? "", rank: null, noindex: true, icon: "", node, file: "<generated>" })
    }
}

function output_name(url: string, extension: string): string {
    if (url === "/404") return "404.html"
    return url === "/" ? `index.${extension}` : `${url.slice(1)}/index.${extension}`
}

// the page payload sits next to its page as "<url>.json" (the root page is index.json)
function json_name(url: string): string {
    return output_name(url, "json")
}

export async function build_site(options: build_options): Promise<build_result> {
    options.out = output_directory(options.root, options.out)
    if (!Number.isFinite(options.build_date.getTime())) throw new Error("Invalid build date")
    const config = await load_config(options.root)
    if (options.base_url) {
        const url = new URL(options.base_url)
        if (!["https:", "http:"].includes(url.protocol) || url.origin !== options.base_url) throw new Error("base_url must be an HTTP(S) origin")
        config.base_url = url.origin
    }
    const diag = new_diagnostics()
    const model = load_site(options.root, config, diag, options.build_date, options.mode)
    synthesize(model)
    const files: output_files = new Map()
    files.set("projects/git.json", JSON.stringify([...new Set(model.objects.filter(node => node.tag === "project" && (node.attrs.repo || node.children.some(child => child.tag === "pipeline"))).map(node => node.attrs.id))]))
    await compile_plugins(model, files)
    const expertise_by_lang = new Map<string, expertise_model | null>(Object.keys(config.languages).map(lang => [lang, build_expertise(model, lang)]))
    fail_on_errors(diag)
    const data_scss = scss_data(expertise_by_lang.get(config.default_language) ?? null)
    const layout = compile_inline_layout(model, data_scss, files)
    const inline_css = (await transform(layout.css + skeleton_css, { loader: "css", minify: true })).code.trim()
    const built = model.themes.filter(node => node.attrs.name && (config.themes === "all" || config.themes.includes(node.attrs.name)))
    const themes: Record<string, theme_assets> = {}
    const manifest: Record<string, { css: string, js: string | null, label: string, colors: [string, string], background: serialized_node }> = {}
    for (const node of built) {
        const result = await compile_theme(model, node, data_scss, files, layout.sources)
        themes[result.name] = result
        manifest[result.name] = { css: result.css, js: result.js, label: result.label, colors: result.colors, background: serialize(background_html(model, result)) }
    }
    if (!themes[config.default_theme]) throw new jazu_error(`default theme "${config.default_theme}" is not built`, 2)
    files.set("assets/themes/manifest.json", JSON.stringify(manifest))
    const page_styles = emit_page_styles(model, files)
    fail_on_errors(diag)
    const runtime = await bundle_runtime(options.root, files, options.mode)
    const nav = JSON.stringify(nav_index(model))
    files.set("assets/nav_index.json", nav)
    const assets: page_assets = { themes, inline_css, runtime_page: runtime.page, runtime_theme_switch: runtime.theme_switch, runtime_desk_shell: runtime.desk_shell, boot_script: runtime.boot, nav_index: nav, page_styles }
    const cache = load_cache(options.root)
    const next_cache: Record<string, string> = {}
    const skipped_outputs = new Map<string, string | Uint8Array>()
    const shared = shared_hash(model, inline_css + JSON.stringify(manifest) + JSON.stringify(runtime) + JSON.stringify([...page_styles.values()]) + options.build_date.toISOString().slice(0, 10))
    let skipped = 0
    for (const page of model.pages) {
        const expertise = expertise_by_lang.get(page.lang) ?? null
        const key = `page:${page.lang}:${page.path}`
        const hash = page_hash(model, page, shared, data_scss)
        const url = page_url(model, page)
        const html_name = output_name(url, "html")
        const names = [html_name, ...(config.render.spa_json && url !== "/404" ? [json_name(url)] : [])]
        const cached = cache[key] === hash && names.every(name => cache[`out:${name}`] && cache[`out:${name}`] === disk_hash(output_file(options.out, name))) && !options.force
        next_cache[key] = hash
        if (cached) {
            skipped++
            for (const name of names) {
                skipped_outputs.set(name, readFileSync(output_file(options.out, name)))
                if (cache[`out:${name}`]) next_cache[`out:${name}`] = cache[`out:${name}`]
            }
            continue
        }
        const rendered = render_page(model, page, assets, { expertise })
        files.set(html_name, rendered.html)
        if (config.render.spa_json && url !== "/404") files.set(json_name(url), JSON.stringify(rendered.json))
    }
    fail_on_errors(diag)
    files.set("sitemap.xml", sitemap_xml(model))
    for (const lang of Object.keys(config.languages)) {
        files.set(feed_path(model, lang, "rss").slice(1), rss_xml(model, lang))
        files.set(feed_path(model, lang, "atom").slice(1), atom_xml(model, lang))
    }
    files.set("robots.txt", robots_txt(model))
    files.set("_headers", headers_file([inline_script_hash(runtime.boot)], [inline_script_hash(inline_css)], model.config.base_url))
    files.set("_redirects", redirects_file())
    const theme_colors = themes[config.default_theme].colors
    const brand = brand_colors(model, theme_colors)
    files.set("manifest.json", manifest_json(model, theme_colors, brand))
    files.set("llms.txt", llms_txt(model))
    if (config.seo.llms.full) files.set("llms-full.txt", llms_full_txt(model))
    const security = security_txt(model)
    if (security) {
        files.set("security.txt", security)
        files.set(".well-known/security.txt", security)
    }
    if (!options.only_check) {
        await icon_files(model, brand, files)
        await cover_files(model, theme_colors, files)
    }
    for (const [url, source] of model.resources) files.set(url.slice(1), readFileSync(source))
    if (options.only_check) return { model, diag, written: [], skipped, pages: model.pages.length }
    const expertise_media = new Set([...expertise_by_lang.values()].flatMap(data => data?.entries.flatMap(entry => [entry.media, entry.poster]) ?? []))
    await pwa_files(options.root, files, skipped_outputs, config, expertise_media)
    const { written, hashes } = write_files(options.out, files)
    for (const [name, hash] of Object.entries(hashes)) next_cache[`out:${name}`] = hash
    // Prune only files in this output's previous manifest; never guess at owner files.
    const manifest_file = join(options.out, ".jazu_output.json")
    const previous: string[] = existsSync(manifest_file) ? JSON.parse(readFileSync(manifest_file, "utf8")) : []
    const current = Object.keys(next_cache).filter(key => key.startsWith("out:")).map(key => key.slice(4))
    const kept = new Set(current)
    for (const name of previous) {
        if (kept.has(name)) continue
        const target = output_file(options.out, name)
        if (existsSync(target) && statSync(target).isFile()) unlinkSync(target)
    }
    writeFileSync(manifest_file, JSON.stringify(current))
    for (const [name, hash] of Object.entries(cache)) if (!(name in next_cache) && name.startsWith("page:") === false && name.startsWith("out:") === false) next_cache[name] = hash
    save_cache(options.root, next_cache)
    return { model, diag, written, skipped, pages: model.pages.length }
}
