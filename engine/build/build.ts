import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync, copyFileSync, unlinkSync } from "node:fs"
import { join, dirname, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { build as esbuild_build, transform } from "esbuild"
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
import { short_hash, sha256, esc_attr, unique } from "../../shared/util.ts"
import { jazu_error } from "../../shared/diag.ts"
import { emit_page_styles } from "../style/page.tsx"
import { output_directory, output_file } from "../../shared/paths.ts"
import { serialize, type serialized_node } from "../../shared/vnode/vnode.tsx"
import { compile_plugins } from "../tags/plugin.ts"
import { pwa_files } from "../routes/sw.js.ts"

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

const runtime_entries: Record<string, string> = {
    "boot": "desk/site/boot.ts",
    "connect_folder": "desk/fs/personal.ts",
    "desk": "desk/index.ts",
    "desk_compare": "desk/plugin/compare.ts",
    "desk_files_util": "desk/window/folder/files.ts",
    "desk_flow": "desk/plugin/flow.ts",
    "desk_flow_rules": "desk/plugin/rules.ts",
    "desk_folder": "desk/window/folder.ts",
    "desk_folder_context": "desk/window/folder/context.ts",
    "desk_folder_cover": "desk/window/folder/cover.ts",
    "desk_folder_drag": "desk/window/folder/drag.ts",
    "desk_folder_drop": "desk/window/folder/drop.ts",
    "desk_fs": "desk/fs/opfs.ts",
    "desk_fs_permissions": "desk/fs/permissions.ts",
    "desk_host": "desk/host/host.ts",
    "desk_markdown": "desk/window/note.ts",
    "desk_media": "desk/window/media.ts",
    "desk_messages": "desk/window/messages.ts",
    "desk_mime": "desk/mime/detect.ts",
    "desk_navigation": "desk/action/history.ts",
    "desk_paths": "desk/fs/paths.ts",
    "desk_pdf": "desk/window/media/pdf.ts",
    "desk_plugins": "desk/plugin/loader.ts",
    "desk_preview": "desk/window/preview.ts",
    "desk_previews": "desk/window/previews.ts",
    "desk_proc": "desk/host/proc.ts",
    "desk_selection": "desk/window/folder/selection.ts",
    "desk_server": "desk/server/desk.ts",
    "desk_server_owner": "desk/server/owner.ts",
    "desk_shell": "desk/window/shell.ts",
    "desk_syntax": "desk/window/text/syntax.ts",
    "desk_users": "desk/work/users.ts",
    "desk_vfs": "desk/fs/vfs.ts",
    "desk_view": "desk/window/index.ts",
    "desk_window_controls": "desk/action/controls.ts",
    "expertise": "desk/site/expertise.ts",
    "home_directory": "desk/fs/home.ts",
    "kernel": "desk/kernel/process.ts",
    "llvm_service": "desk/program/gcc/service.ts",
    "loading": "desk/site/loading.ts",
    "memory_fs": "desk/fs/memory.ts",
    "menus": "desk/site/menus.ts",
    "notifications": "desk/site/notifications.ts",
    "page": "desk/site/page.ts",
    "pager": "desk/site/pager.ts",
    "print": "desk/site/print.ts",
    "proc_types": "desk/kernel/types.ts",
    "pwa": "desk/site/pwa.ts",
    "realtime": "desk/work/realtime.ts",
    "realtime_time": "desk/work/time.ts",
    "rireki_editor": "desk/site/rireki_editor.ts",
    "scroll": "desk/site/scroll.ts",
    "search": "desk/site/search.ts",
    "server_audio": "desk/server/audio.ts",
    "server_fs": "desk/server/fs.ts",
    "server_input": "desk/server/input.ts",
    "server_link": "desk/server/link.ts",
    "server_pty": "desk/server/pty.ts",
    "server_script": "desk/server/script.ts",
    "server_script_model": "desk/server/script_model.ts",
    "server_sessions": "desk/server/sessions.ts",
    "server_sessions_model": "desk/server/sessions_model.ts",
    "server_site": "desk/server/site.ts",
    "server_terminal": "desk/server/terminal.ts",
    "server_text": "desk/server/text.ts",
    "server_touch": "desk/server/touch.ts",
    "server_windows": "desk/server/windows.ts",
    "sign": "desk/work/sign.ts",
    "spa": "desk/site/spa.ts",
    "theme_switch": "desk/site/theme_switch.ts",
    "wasm_host": "desk/kernel/wasm_host.ts",
    "wasm_procfs": "desk/kernel/procfs.ts",
    "wasm_protocol": "desk/kernel/wasm_protocol.ts",
    "wasm_worker": "desk/kernel/worker.ts",
    "wasm_worker_runtime": "desk/kernel/worker_runtime.ts",
    "work_drive": "desk/work/drive.ts",
    "work_session": "desk/work/session.ts"
}

async function bundle_script(root: string, entry: string, files: output_files, mode: string): Promise<string> {
    const outdir = join(root, ".cache", "runtime")
    const result = await esbuild_build({
        entryPoints: [{ in: join(root, runtime_entries[entry]), out: entry }], outdir, write: false, bundle: true, format: "iife",
        minify: mode === "production", entryNames: "assets/runtime/[name].[hash]", target: "es2020", logLevel: "silent",
        external: ["node:*", "ws", "@wasmer/sdk"],
    })
    const output = result.outputFiles[0]
    const rel = relative(outdir, output.path).replace(/\\/g, "/")
    files.set(rel, Buffer.from(output.contents))
    return "/" + rel
}

async function bundle_runtime(root: string, files: output_files, mode: string): Promise<{ page: string, theme_switch: string, desk_shell: string, boot: string }> {
    const build_dir = join(root, "build")
    const bb_dir = join(build_dir, "busybox")
    const worker = await bundle_script(root, "wasm_worker", files, mode)
    const wasm_bytes = readFileSync(join(bb_dir, "busybox.wasm"))
    const hash = sha256(wasm_bytes)
    const wasm_path = `assets/wasm/busybox-${hash.slice(0, 10)}.wasm`
    files.set(wasm_path, wasm_bytes)
    files.set("assets/wasm/busybox-LICENSE", readFileSync(join(bb_dir, "LICENSE")))
    files.set("assets/wasm/busybox.config", readFileSync(join(bb_dir, "busybox.config")))
    files.set("assets/terminal/xterm-5.5.0.css", readFileSync(fileURLToPath(import.meta.resolve("@xterm/xterm/css/xterm.css"))))
    files.set("assets/wasm/busybox-source.tar.bz2", readFileSync(join(bb_dir, "busybox-source.tar.bz2")))
    for (const name of ["build.sh", "port.py", "host.c"]) {
        const p = join(root, "desk/program/busybox", name)
        if (existsSync(p)) files.set(`assets/wasm/busybox-port/${name}`, readFileSync(p))
    }
    const loader = async (name: string): Promise<string> => {
        const bundled = await esbuild_build({ entryPoints: [join(build_dir, name, `${name}.js`)], bundle: true, write: false, format: "esm", minify: mode === "production", target: "es2020", external: ["node:*", "ws", "@wasmer/sdk"], logLevel: "silent" })
        const bytes = bundled.outputFiles[0].contents
        const path = `assets/wasm/${name}-${sha256(bytes).slice(0, 10)}.mjs`
        files.set(path, Buffer.from(bytes))
        return "/" + path
    }
    const images: { id: string, version: string, worker: string, loader: string, runtime?: string, applet: boolean, wasm: string, sha256: string, commands: string[], license: string, source: string }[] = [{ id: "busybox", loader: await loader("busybox"), applet: true, version: "1.36.1-jazu.2", worker, wasm: "/" + wasm_path, sha256: hash,
        commands: JSON.parse(readFileSync(join(bb_dir, "commands.json"), "utf8")) as string[], license: "/assets/wasm/busybox-LICENSE", source: "/assets/wasm/busybox-source.tar.bz2" }]
    const programs = readdirSync(join(root, "desk/program"), { withFileTypes: true }).filter(entry => entry.isDirectory() && entry.name !== "busybox" && existsSync(join(root, "desk/program", entry.name, "program.json"))).map(entry => JSON.parse(readFileSync(join(root, "desk/program", entry.name, "program.json"), "utf8")))
    for (const program of programs) {
        const { name, version, extension, commands: cmd_list } = program

        const pkg_dir = join(build_dir, name)
        const bytes = readFileSync(join(pkg_dir, `${name}.wasm`)), hash = sha256(bytes)
        if (hash !== program.sha256) throw new Error(`Program integrity differs from desk/program/${name}/program.json`)
        const path = `assets/wasm/${name}-${hash.slice(0, 10)}.wasm`
        files.set(path, bytes)
        const lic_path = existsSync(join(pkg_dir, `${name}-LICENSE`)) ? join(pkg_dir, `${name}-LICENSE`) : join(pkg_dir, "LICENSE")
        files.set(`assets/wasm/${name}-LICENSE`, readFileSync(lic_path))
        files.set(`assets/wasm/${name}-source.${extension}`, readFileSync(join(pkg_dir, `${name}-source.${extension}`)))
        let runtime: string | undefined
        if (program.runtime) {
            const compiled = await esbuild_build({ entryPoints: [join(root, program.runtime)], bundle: true, write: false, format: "esm", minify: mode === "production", external: ["node:*", "ws", "@wasmer/sdk"], logLevel: "silent" })
            const path = `assets/wasm/${name}-runtime-${sha256(compiled.outputFiles[0].contents).slice(0, 10)}.mjs`
            files.set(path, Buffer.from(compiled.outputFiles[0].contents))
            runtime = "/" + path
        }
        images.push({ runtime, id: name, version, worker, loader: await loader(name), applet: false, wasm: "/" + path, sha256: hash, commands: cmd_list ?? [name], license: `/assets/wasm/${name}-LICENSE`, source: `/assets/wasm/${name}-source.${extension}` })
    }
    const extra_assets: [string, string][] = [
        ["htop", "ncurses-source.tar.gz"],
        ["tcc", "tcc-sysroot.json"],
        ["tcc", "tcc-sysroot-LICENSE"],
        ["python_suite", "python_stdlib.zip"],
        ["python_suite", "pyodide.asm.js"],
        ["python_suite", "pyodide-lock.json"],
        ["python_suite", "pyodide.asm.wasm"],
        ["python_suite", "numpy-2.0.2-cp312-cp312-pyodide_2024_0_wasm32.whl"],
        ["clang", "clang.webc"],
    ]
    for (const [pkg, asset] of extra_assets) {
        const p = join(build_dir, pkg, asset)
        if (existsSync(p)) files.set(`assets/wasm/${asset}`, readFileSync(p))
    }
    const common_custom = join(root, "desk/program/common")
    for (const name of ["build.sh", "port.py", "compat.c", "package.ts"]) {
        const p = join(common_custom, name)
        if (existsSync(p)) files.set(`assets/wasm/programs-port/${name}`, readFileSync(p))
    }
    const wasmer_root = join(root, "node_modules", "@wasmer", "sdk")
    if (existsSync(wasmer_root)) {
        for (const dir of ["dist", "pkg"]) {
            const dir_path = join(wasmer_root, dir)
            if (existsSync(dir_path)) {
                for (const file of readdirSync(dir_path, { recursive: true })) {
                    const full = join(dir_path, String(file))
                    if (statSync(full).isFile()) {
                        const rel = relative(wasmer_root, full).replace(/\\/g, "/")
                        files.set(`assets/wasmer/${rel}`, readFileSync(full))
                    }
                }
            }
        }
    }
    files.set("assets/wasm/manifest.json", JSON.stringify(images))
    // PDF.js stays out of the page bundle and is fetched only when a PDF is opened.
    const pdf_root = dirname(fileURLToPath(import.meta.resolve("pdfjs-dist/package.json")))
    const pdf_version = JSON.parse(readFileSync(join(pdf_root, "package.json"), "utf8")).version
    const pdf_base = `assets/pdfjs/${pdf_version}`
    for (const folder of ["build", "cmaps", "standard_fonts", "wasm"]) {
        for (const name of readdirSync(join(pdf_root, folder), { recursive: true })) {
            const path = join(pdf_root, folder, String(name))
            if (statSync(path).isFile() && !String(name).endsWith(".map") && (folder !== "build" || ["pdf.min.mjs", "pdf.worker.min.mjs"].includes(String(name)))) {
                files.set(`${pdf_base}/${folder}/${String(name).replace(/\\/g, "/")}`, readFileSync(path))
            }
        }
    }
    files.set(`${pdf_base}/LICENSE`, readFileSync(join(pdf_root, "LICENSE")))
    files.set("assets/pdfjs.json", JSON.stringify({ base: `/${pdf_base}/`, module: `/${pdf_base}/build/pdf.min.mjs`, worker: `/${pdf_base}/build/pdf.worker.min.mjs` }))
    const page = await bundle_script(root, "page", files, mode)
    const theme_switch = await bundle_script(root, "theme_switch", files, mode)
    // Executable registration is small; WASM bytes remain lazy until a process starts.
    const desk_shell = await bundle_script(root, "desk_shell", files, mode)
    const boot = await esbuild_build({ entryPoints: [join(root, "desk/site/boot.ts")], bundle: true, write: false, format: "iife", minify: true, logLevel: "silent" })
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
