import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync, copyFileSync, unlinkSync } from "node:fs"
import { join, dirname, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { build as esbuild_build, transform } from "esbuild"
import { load_config } from "./config.ts"
import type { diagnostics } from "./diag.ts"
import { new_diagnostics, fail_on_errors } from "./diag.ts"
import type { site_model, page } from "./model.ts"
import { load_site, page_url, ui_text } from "./model.ts"
import { parse_xml } from "./xml.ts"
import { validate_roots } from "./schema.ts"
import { build_expertise, scss_data } from "./expertise.ts"
import type { expertise_model } from "./expertise.ts"
import type { output_files } from "./theme_css.ts"
import { compile_theme, compile_inline_layout } from "./theme_css.ts"
import { skeleton_css } from "./web/skeleton_css.ts"
import type { page_assets, theme_assets } from "./web/html_page.tsx"
import { render_page, background_html } from "./web/html_page.tsx"
import { sitemap_xml, robots_txt, headers_file, redirects_file, inline_script_hash, nav_index } from "./web/seo.tsx"
import { manifest_json, security_txt } from "./web/seo_files.tsx"
import { llms_txt, llms_full_txt } from "./web/seo_text.tsx"
import { icon_files, cover_files, brand_colors } from "./web/seo_images.tsx"
import { load_cache, save_cache } from "./cache.ts"
import { page_hash, shared_hash } from "./graph.ts"
import { short_hash, sha256, esc_attr, unique } from "./util.ts"
import { jazu_error } from "./diag.ts"
import { emit_page_styles } from "./web/page_style.tsx"
import { output_directory, output_file } from "./paths.ts"
import { serialize, type serialized_node } from "./web/vnode.tsx"
import { compile_plugins } from "./plugins.ts"

export type build_options = {
    root: string
    out: string
    mode: "production" | "development"
    force: boolean
    build_date: Date
    only_check: boolean
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

async function bundle_script(root: string, entry: string, files: output_files, mode: string): Promise<string> {
    const outdir = join(root, ".cache", "runtime")
    const result = await esbuild_build({
        entryPoints: [{ in: join(root, "src", "web", "client", `${entry}.ts`), out: entry }], outdir, write: false, bundle: true, format: "iife",
        minify: mode === "production", entryNames: "assets/runtime/[name].[hash]", target: "es2020", logLevel: "silent",
    })
    const output = result.outputFiles[0]
    const rel = relative(outdir, output.path).replace(/\\/g, "/")
    files.set(rel, Buffer.from(output.contents))
    return "/" + rel
}

async function bundle_runtime(root: string, files: output_files, mode: string): Promise<{ page: string, theme_switch: string, desk_shell: string, boot: string }> {
    const artifact = join(root, "src", "desk", "busybox", "artifacts")
    const worker = await bundle_script(root, "wasm_worker", files, mode)
    const wasm_bytes = readFileSync(join(artifact, "busybox.wasm"))
    const hash = sha256(wasm_bytes)
    const wasm_path = `assets/wasm/busybox-${hash.slice(0, 10)}.wasm`
    files.set(wasm_path, wasm_bytes)
    files.set("assets/wasm/busybox-LICENSE", readFileSync(join(artifact, "LICENSE")))
    files.set("assets/wasm/busybox.config", readFileSync(join(artifact, "busybox.config")))
    files.set("assets/terminal/xterm-5.5.0.css", readFileSync(fileURLToPath(import.meta.resolve("@xterm/xterm/css/xterm.css"))))
    files.set("assets/wasm/busybox-source.tar.bz2", readFileSync(join(artifact, "busybox-source.tar.bz2")))
    for (const name of ["build.sh", "port.py", "host.c"]) files.set(`assets/wasm/busybox-port/${name}`, readFileSync(join(root, "src", "desk", "busybox", name)))
    const images = [{ id: "busybox", version: "1.36.1-jazu.2", worker, wasm: "/" + wasm_path, sha256: hash,
        commands: JSON.parse(readFileSync(join(artifact, "commands.json"), "utf8")) as string[], license: "/assets/wasm/busybox-LICENSE", source: "/assets/wasm/busybox-source.tar.bz2" }]
    const programs = join(root, "src", "desk", "programs", "artifacts")
    for (const [name, version, extension, cmd_list] of [
        ["fastfetch", "2.40.4-jazu.1", "tar.gz"],
        ["htop", "3.4.1-jazu.1", "tar.gz"],
        ["tcc", "0.9.27-i386-jazu.1", "tar.bz2"],
        ["jq", "1.7.1-jazu.1", "tar.gz"],
        ["bchunk", "1.2.2-jazu.1", "tar.gz"],
        ["caesar", "1.0.0-bsd-jazu.1", "tar.gz"],
        ["morse", "1.0.0-bsd-jazu.1", "tar.gz"],
        ["optipng", "0.7.8-jazu.1", "tar.gz"],
        ["cwebp", "1.4.0-jazu.1", "tar.gz"],
        ["dwebp", "1.4.0-jazu.1", "tar.gz"],
        ["potrace", "1.16-jazu.1", "tar.gz"],
        ["flac", "1.4.3-jazu.1", "tar.xz"],
        ["mkbitmap", "1.16-jazu.1", "tar.gz"],
        ["metaflac", "1.4.3-jazu.1", "tar.xz"],
        ["bin2iso", "1.9.b-jazu.1", "tar.gz"],
        ["tree", "2.1.3-jazu.1", "tar.gz"],
        ["pwgen", "2.08-jazu.1", "tar.gz"],
        ["lame", "3.100-jazu.1", "tar.gz"],
        ["urlencode", "1.0.0-jazu.1", "tar.gz", ["urlencode", "urldecode"]],
        ["htmlencode", "1.0.0-jazu.1", "tar.gz", ["htmlencode", "htmldecode"]],
        ["rot13", "1.0.0-jazu.1", "tar.gz"],
        ["atob", "1.0.0-jazu.1", "tar.gz"],
        ["btoa", "1.0.0-jazu.1", "tar.gz"],
        ["sha384sum", "1.0.0-jazu.1", "tar.gz"],
        ["json_flatten", "1.0.0-jazu.1", "tar.gz", ["json-flatten"]],
        ["csv_json", "1.0.0-jazu.1", "tar.gz", ["csv2json", "json2csv", "tsv2json", "json2tsv"]],
        ["json2yaml", "1.0.0-jazu.1", "tar.gz", ["json2yaml"]],
        ["ini_env_json", "1.0.0-jazu.1", "tar.gz", ["ini2json", "env2json", "json2env"]],
        ["casing_tools", "1.0.0-jazu.1", "tar.gz", ["title-case", "titlecase", "camel-case", "camelcase", "snake-case", "snakecase", "kebab-case", "kebabcase", "slugify"]],
        ["text_stats", "1.0.0-jazu.1", "tar.gz", ["count-chars", "charfreq"]],
        ["text_gen", "1.0.0-jazu.1", "tar.gz", ["lorem", "str-repeat"]],
        ["banner", "1.0.0-jazu.1", "tar.gz", ["banner", "banner-js"]],
        ["word_games", "1.0.0-jazu.1", "tar.gz", ["pig-latin", "anagram", "palindrome"]],
        ["numbase", "1.0.0-jazu.1", "tar.gz", ["numbase", "dec2bin", "dec2hex", "dec2oct", "hex2dec"]],
        ["random_bytes", "1.0.0-jazu.1", "tar.gz", ["random-bytes"]],
        ["math_suite", "1.0.0-jazu.1", "tar.gz", ["fib", "fibonacci", "gcd", "lcm", "stats", "matrix"]],
        ["uuid_token", "1.0.0-jazu.1", "tar.gz", ["uuidgen", "uuidgen-js", "nanoid"]],
        ["color_tools", "1.0.0-jazu.1", "tar.gz", ["hex2rgb", "rgb2hex", "color-mix"]],
        ["date_units", "1.0.0-jazu.1", "tar.gz", ["date-diff", "bytes-human", "temp", "unit"]],
        ["qr", "1.0.0-jazu.1", "tar.gz", ["qr"]],
        ["net_tools", "1.0.0-jazu.1", "tar.gz", ["url-parse", "http-status", "mime-type"]],
        ["file_analysis", "1.0.0-jazu.1", "tar.gz", ["entropy", "detect-encoding", "file-info"]],
        ["string_helpers", "1.0.0-jazu.1", "tar.gz", ["escape-string", "unescape-string", "count-tokens"]],
        ["markup_tools", "1.0.0-jazu.1", "tar.gz", ["md2html", "html2text"]],
        ["tools_catalog", "1.0.0-jazu.1", "tar.gz", ["tools"]],
    ] as [string, string, string, string[]?][]) {
        const bytes = readFileSync(join(programs, `${name}.wasm`)), hash = sha256(bytes)
        const path = `assets/wasm/${name}-${hash.slice(0, 10)}.wasm`
        files.set(path, bytes)
        files.set(`assets/wasm/${name}-LICENSE`, readFileSync(join(programs, `${name}-LICENSE`)))
        files.set(`assets/wasm/${name}-source.${extension}`, readFileSync(join(programs, `${name}-source.${extension}`)))
        images.push({ id: name, version, worker: await bundle_script(root, `wasm_worker_${name}`, files, mode), wasm: "/" + path, sha256: hash, commands: cmd_list ?? [name], license: `/assets/wasm/${name}-LICENSE`, source: `/assets/wasm/${name}-source.${extension}` })
    }
    for (const name of ["ncurses-source.tar.gz", "tcc-sysroot.json", "tcc-sysroot-LICENSE"]) files.set(`assets/wasm/${name}`, readFileSync(join(programs, name)))
    for (const name of ["build.sh", "port.py", "compat.c", "htop_processes.c", "package.ts", "README.md"]) files.set(`assets/wasm/programs-port/${name}`, readFileSync(join(root, "src", "desk", "programs", name)))
    files.set("assets/wasm/manifest.json", JSON.stringify(images))
    const page = await bundle_script(root, "page", files, mode)
    const theme_switch = await bundle_script(root, "theme_switch", files, mode)
    // Executable registration is small; WASM bytes remain lazy until a process starts.
    const desk_shell = await bundle_script(root, "desk_shell", files, mode)
    const boot = await esbuild_build({ entryPoints: [join(root, "src", "web", "client", "boot.ts")], bundle: true, write: false, format: "iife", minify: true, logLevel: "silent" })
    return { page, theme_switch, desk_shell, boot: boot.outputFiles[0].text.trim() }
}

function disk_hash(file: string): string | null {
    return existsSync(file) ? sha256(readFileSync(file)) : null
}

function write_files(out: string, files: output_files): { written: string[], hashes: Record<string, string> } {
    const written: string[] = []
    const hashes: Record<string, string> = {}
    for (const [name, content] of files) {
        const target = output_file(out, name)
        const hash = sha256(content)
        hashes[name] = hash
        if (disk_hash(target) === hash) continue
        mkdirSync(dirname(target), { recursive: true })
        writeFileSync(target, content)
        written.push(name)
    }
    return { written, hashes }
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
    const diag = new_diagnostics()
    const model = load_site(options.root, config, diag, options.build_date, options.mode)
    synthesize(model)
    const files: output_files = new Map()
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
    files.set("robots.txt", robots_txt(model))
    files.set("_headers", headers_file([inline_script_hash(runtime.boot)], [inline_script_hash(inline_css)]))
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
