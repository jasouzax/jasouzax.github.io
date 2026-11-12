#!/usr/bin/env node
import { resolve, join, dirname, relative, sep } from "node:path"
import { watch, rmSync, rmdirSync, mkdtempSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { deflateRawSync } from "node:zlib"
import { fileURLToPath } from "node:url"
import { build_site } from "./build.ts"
import { check_links, check_media, check_page_rules, check_seo, tier_report } from "./check.ts"
import { jazu_error, new_diagnostics } from "./diag.ts"
import { serve } from "./node/serve.ts"
import { add_icon, load_icons } from "./icons.ts"
import { load_site } from "./model.ts"
import type { site_model } from "./model.ts"
import { load_config } from "./config.ts"
import { child_nodes } from "./xml.ts"
import { decode_char } from "./font_build.ts"
import { cache_file } from "./cache.ts"
import { output_directory, inside } from "./paths.ts"
import { realpathSync } from "node:fs"
import { dependency_graph } from "./graph.ts"
import { collect_unignored } from "./gitignore.ts"
import { deploy, load_env } from "./node/deploy.ts"
import { publish_pages } from "./node/publish.ts"
import { server_command } from "./node/server_cli.ts"

type flags = Record<string, string | boolean>

function parse_args(args: string[]): { words: string[], flags: flags } {
    const words: string[] = []
    const flags: flags = {}
    for (let index = 0; index < args.length; index++) {
        const arg = args[index]
        if (!arg.startsWith("--")) {
            words.push(arg)
            continue
        }
        const name = arg.slice(2)
        const next = args[index + 1]
        if (next && !next.startsWith("--") && ["out", "port", "root", "date", "out_file", "target", "overlay", "state_file", "commit", "message", "config", "role", "project"].includes(name)) {
            flags[name] = next
            index++
        } else flags[name] = true
    }
    return { words, flags }
}

function show(result: Awaited<ReturnType<typeof build_site>>): void {
    for (const warning of result.diag.warnings) console.warn(`warning: ${warning}`)
}

async function run_build(root: string, flags: flags, only_check: boolean): ReturnType<typeof build_site> {
    return build_site({
        root, out: output_directory(root, String(flags.out ?? "dist")), mode: flags.dev ? "development" : "production", force: Boolean(flags.force),
        build_date: flags.date ? new Date(String(flags.date)) : new Date(), only_check,
    })
}

async function main(): Promise<void> {
    const { words, flags } = parse_args(process.argv.slice(2))
    const root = resolve(String(flags.root ?? process.cwd()))
    const command = words[0] ?? "build"
    if (command === "node") {
        (await import("./node/listener_main.ts")).start_listener(root, flags)
        return
    }
    if (command === "server") {
        server_command(words.slice(1), flags, root)
        return
    }
    if (command === "publish") {
        // CD: build, compare with the last successful deploy, upload with wrangler only when something differs.
        load_env(root)
        const result = flags.skip_build ? undefined : await run_build(root, flags, false)
        if (result) show(result)
        const config = result?.model.config ?? await load_config(root)
        const outcome = publish_pages(root, output_directory(root, String(flags.out ?? "dist")), config.deploy.pages_project, {
            overlay_dir: flags.overlay ? resolve(String(flags.overlay)) : undefined, state_file: flags.state_file ? resolve(String(flags.state_file)) : undefined,
            dry_run: Boolean(flags.dry_run), force: Boolean(flags.force), commit: flags.commit ? String(flags.commit) : undefined, message: flags.message ? String(flags.message) : undefined,
        })
        if (outcome.large_assets.length) console.warn(`warning: ${outcome.large_assets.length} file(s) over 25 MiB are served from R2`)
        console.log(`JAZU_PUBLISH ${JSON.stringify(outcome)}`)
        return
    }
    if (command === "deploy") {
        const result = await run_build(root, flags, false)
        show(result)
        await deploy(root, output_directory(root, String(flags.out ?? "dist")), result, String(flags.target ?? "all"), Boolean(flags.dry_run))
        return
    }
    if (command === "build") {
        const result = await run_build(root, flags, false)
        show(result)
        console.log(`built ${result.pages} pages, wrote ${result.written.length} files, skipped ${result.skipped} unchanged pages`)
        return
    }
    if (command === "check") {
        const result = await run_build(root, flags, true)
        check_links(result.model)
        check_media(result.model)
        check_page_rules(result.model)
        check_seo(result.model)
        show(result)
        for (const error of result.diag.errors) console.error(`error: ${error}`)
        if (flags.report) await print_report(root, flags)
        if (result.diag.errors.length > 0 || (flags.strict && result.diag.warnings.length > 0)) process.exitCode = 1
        else console.log(`ok: ${result.pages} pages, ${result.diag.warnings.length} warnings`)
        return
    }
    if (command === "serve") {
        const result = await run_build(root, flags, false)
        show(result)
        serve(resolve(root, String(flags.out ?? "dist")), Number(flags.port ?? 8080))
        return
    }
    if (command === "watch") {
        await run_build(root, { ...flags, dev: true }, false)
        let timer: NodeJS.Timeout | undefined
        let running = false
        let again = false
        const rebuild = async (): Promise<void> => {
            if (running) { again = true; return }
            running = true
            try { do { again = false; show(await run_build(root, { ...flags, dev: true }, false)) } while (again) }
            catch (error) { console.error(error instanceof Error ? error.message : error) }
            finally { running = false }
        }
        const changed = () => {
            clearTimeout(timer)
            timer = setTimeout(() => void rebuild(), 150)
        }
        watch(join(root, "content"), { recursive: true }, changed)
        watch(join(root, "src"), { recursive: true }, changed)
        watch(join(root, "config.json"), changed)
        console.log("watching content/, src/ and config.json (restart watch after engine changes)")
        return
    }
    if (command === "clean") {
        const out = output_directory(root, String(flags.out ?? "dist"))
        if (existsSync(out) && !existsSync(join(out, ".jazu_output.json"))) throw new Error("Refusing to clean output without .jazu_output.json")
        const cache = join(root, ".cache")
        if (existsSync(cache) && !inside(realpathSync(root), realpathSync(cache))) throw new Error("Cache junction escapes project")
        rmSync(out, { recursive: true, force: true })
        rmSync(cache, { recursive: true, force: true })
        return
    }
    if (command === "icons") {
        if (words.length === 1 || words[1] === "check") await icons_audit(root, flags)
        else icons_command(root, words.slice(1))
        return
    }
    if (command === "graph") {
        const result = await run_build(root, flags, true)
        console.log(JSON.stringify(dependency_graph(result.model), null, 4))
        return
    }
    if (command === "pack") {
        // project dir is the parent of src/ (where this file lives), unless --root is given
        const project = flags.root ? root : dirname(dirname(fileURLToPath(import.meta.url)))
        await pack_command(project, String(flags.out_file ?? "codebase.zip"), words.slice(1))
        return
    }
    console.error(`unknown command "${command}". commands: build, check, serve, watch, clean, icons, graph, pack, deploy, publish, node, server`)
    process.exitCode = 1
}

async function print_report(root: string, flags: flags): Promise<void> {
    const out = resolve(root, String(flags.out ?? "dist"))
    const themes = join(out, "assets", "themes")
    if (!existsSync(themes)) return console.log("report: run build first")
    const { readdirSync } = await import("node:fs")
    for (const name of readdirSync(join(themes, "default"))) {
        if (!name.endsWith(".css")) continue
        console.log(`browser tiers for default theme css:`)
        for (const line of tier_report(readFileSync(join(themes, "default", name), "utf8"))) console.log(`  ${line}`)
    }
}

function icons_command(root: string, words: string[]): void {
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

async function icons_audit(root: string, flags: flags): Promise<void> {
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

const crc_table = (() => {
    const table = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
        let c = n
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
        table[n] = c >>> 0
    }
    return table
})()

function crc32(data: Buffer): number {
    let crc = 0xffffffff
    for (let index = 0; index < data.length; index++) crc = crc_table[(crc ^ data[index]) & 0xff] ^ (crc >>> 8)
    return (crc ^ 0xffffffff) >>> 0
}

function collect_files(path: string, found: string[] = []): string[] {
    const stat = statSync(path)
    if (stat.isFile()) {
        found.push(path)
        return found
    }
    for (const name of readdirSync(path).sort()) {
        if (name === "node_modules" || name === ".DS_Store") continue
        collect_files(join(path, name), found)
    }
    return found
}

function make_zip(entries: { name: string, data: Buffer, mtime: Date }[]): Buffer {
    const parts: Buffer[] = []
    const central: Buffer[] = []
    let offset = 0
    for (const entry of entries) {
        const name = Buffer.from(entry.name, "utf8")
        const crc = crc32(entry.data)
        const deflated = deflateRawSync(entry.data)
        const stored = deflated.length >= entry.data.length
        const body = stored ? entry.data : deflated
        const method = stored ? 0 : 8
        const d = entry.mtime
        const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)
        const date = (Math.max(d.getFullYear() - 1980, 0) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()

        const local = Buffer.alloc(30)
        local.writeUInt32LE(0x04034b50, 0)
        local.writeUInt16LE(20, 4)
        local.writeUInt16LE(0x0800, 6) // utf-8 names
        local.writeUInt16LE(method, 8)
        local.writeUInt16LE(time, 10)
        local.writeUInt16LE(date, 12)
        local.writeUInt32LE(crc, 14)
        local.writeUInt32LE(body.length, 18)
        local.writeUInt32LE(entry.data.length, 22)
        local.writeUInt16LE(name.length, 26)
        local.writeUInt16LE(0, 28)
        parts.push(local, name, body)

        const header = Buffer.alloc(46)
        header.writeUInt32LE(0x02014b50, 0)
        header.writeUInt16LE(20, 4)
        header.writeUInt16LE(20, 6)
        header.writeUInt16LE(0x0800, 8)
        header.writeUInt16LE(method, 10)
        header.writeUInt16LE(time, 12)
        header.writeUInt16LE(date, 14)
        header.writeUInt32LE(crc, 16)
        header.writeUInt32LE(body.length, 20)
        header.writeUInt32LE(entry.data.length, 24)
        header.writeUInt16LE(name.length, 28)
        header.writeUInt32LE(offset, 42)
        central.push(header, name)

        offset += local.length + name.length + body.length
    }
    const central_size = central.reduce((sum, part) => sum + part.length, 0)
    const end = Buffer.alloc(22)
    end.writeUInt32LE(0x06054b50, 0)
    end.writeUInt16LE(entries.length, 8)
    end.writeUInt16LE(entries.length, 10)
    end.writeUInt32LE(central_size, 12)
    end.writeUInt32LE(offset, 16)
    return Buffer.concat([...parts, ...central, end])
}

async function pack_command(project: string, file_name: string, additions: string[] = []): Promise<void> {
    const config = await load_config(project)
    const excluded = config.pack.exclude.map(path => {
        const target = resolve(project, path)
        if (!inside(project, target) || target === resolve(project)) throw new Error(`Unsafe pack exclusion: ${path}`)
        return target
    })
    const out = join(project, file_name)
    // The whole working tree minus whatever the root and nested .gitignore files exclude. Git is not consulted,
    // so this works without git or a .git folder, and tracked-but-ignored files are still left out.
    const files = new Set(collect_unignored(project, path => path === out || excluded.some(target => inside(target, path))))
    // Paths given on the command line are explicit opt-ins, even if a .gitignore excludes them.
    for (const target of additions) {
        const path = resolve(project, target)
        if (!inside(project, path) || !existsSync(path)) {
            console.warn(`warning: ${target} not found or outside the project, skipping`)
            continue
        }
        for (const file of collect_files(path)) files.add(file)
    }
    const entries = [...files].sort().map(path => ({
        name: relative(project, path).split(sep).join("/"),
        data: readFileSync(path),
        mtime: statSync(path).mtime,
    }))
    writeFileSync(out, make_zip(entries))
    const megabytes = entries.reduce((sum, entry) => sum + entry.data.length, 0) / 1024 / 1024
    console.log(`packed ${entries.length} files (${megabytes.toFixed(1)} MiB uncompressed) into ${out}`)
}

main().catch(error => {
    console.error(error instanceof jazu_error ? error.message : error)
    process.exitCode = error instanceof jazu_error ? error.code : 1
})
