import { readdirSync, readFileSync, statSync, existsSync, lstatSync } from "node:fs"
import { join, relative, dirname } from "node:path"
import type { xml_node } from "./xml.ts"
import { parse_xml, where_of, walk_nodes } from "./xml.ts"
import { validate_roots, is_true } from "./schema.ts"
import type { diagnostics } from "./diag.ts"
import { report_error, report_warning } from "./diag.ts"
import type { site_config } from "./config.ts"
import type { icon_registry } from "./icons.ts"
import { load_icons, icon_chars } from "./icons.ts"
import { year_fraction } from "./dates.ts"
import { normalize_path, parent_path, path_depth } from "./util.ts"
import { expand_objects, collect_resources } from "./objects.ts"
import { inside } from "./paths.ts"

export type page = {
    path: string
    lang: string
    name: string
    info: string
    rank: number | null
    noindex: boolean
    icon: string
    node: xml_node
    file: string
}

export type site_model = {
    config: site_config
    root: string
    content_dir: string
    pages: page[]
    themes: xml_node[]
    objects: xml_node[]
    prints: xml_node[]
    plugins: xml_node[]
    resources: Map<string, string>
    icons: icon_registry
    diag: diagnostics
    now: number
    build_date: Date
    mode: "production" | "development"
}

function list_xml(dir: string): string[] {
    if (!existsSync(dir)) return []
    const found: string[] = []
    for (const name of readdirSync(dir).sort()) {
        const full = join(dir, name)
        if (lstatSync(full).isSymbolicLink()) continue
        if (statSync(full).isDirectory()) found.push(...list_xml(full))
        else if (name.endsWith(".xml")) found.push(full)
    }
    return found
}

export function source_files(content_dir: string): string[] {
    return list_xml(content_dir)
}

export function ui_text(model: site_model, lang: string, key: string): string {
    return model.config.languages[lang]?.[key] ?? model.config.languages[model.config.default_language]?.[key] ?? key
}

export function icon_of(model: site_model, value: string | undefined, where: string): string {
    return icon_chars(value, model.icons, name => report_warning(model.diag, where, `unknown icon token [${name}]`)).replace(/\ufdd0/g, "[")
}

function make_page(node: xml_node, root: string): page {
    const path = normalize_path(node.attrs.path ?? "/")
    const rank = node.attrs.rank === undefined ? null : Number(node.attrs.rank)
    return {
        path,
        lang: node.attrs.lang ?? "en",
        name: node.attrs.name ?? path,
        info: node.attrs.info ?? "",
        rank: Number.isFinite(rank) ? rank : null,
        noindex: is_true(node.attrs.noindex),
        icon: node.attrs.icon ?? "",
        node,
        file: relative(root, node.file),
    }
}

export function load_site(root: string, config: site_config, diag: diagnostics, build_date: Date, mode: "production" | "development" = "production"): site_model {
    const content_dir = join(root, "content")
    const model: site_model = {
        config, root, content_dir, pages: [], themes: [], objects: [], prints: [], plugins: [], resources: new Map(), diag, build_date, mode, now: year_fraction(build_date),
        icons: { start: "E000", icons: config.icons },
    }
    for (const file of source_files(content_dir)) {
        const roots = parse_xml(readFileSync(file, "utf8"), file)
        validate_roots(roots, diag)
        for (const node of roots) {
            if (node.tag === "page" && dirname(file) !== content_dir) report_error(diag, where_of(node), "<page> files belong directly under content")
            if (node.tag === "blog" && !inside(join(content_dir, "blogs"), file)) report_error(diag, where_of(node), "<blog> files belong under content/blogs")
            if (node.tag === "theme" && !inside(join(content_dir, "theme"), file)) report_error(diag, where_of(node), "<theme> files belong under content/theme")
            walk_nodes(node, child => {
                for (const name of ["text", "name", "info", "data"]) if (child.attrs[name]) {
                    child.attrs[name] = icon_chars(child.attrs[name], model.icons, token => report_warning(diag, where_of(child), `unknown icon token [${token}]`)).replace(/\ufdd0/g, "[")
                }
            })
            if (["page", "project", "event", "blog"].includes(node.tag)) node.attrs.lang ??= config.default_language
            if (node.tag === "page") model.pages.push(make_page(node, root))
            if (node.tag === "theme") model.themes.push(node)
            if (["project", "event", "blog"].includes(node.tag)) model.objects.push(node)
            if (node.tag === "print") model.prints.push(node)
            if (node.tag === "plugins") model.plugins.push(...node.children)
        }
    }
    expand_objects(model)
    collect_resources(model)
    check_pages(model)
    return model
}

function check_pages(model: site_model): void {
    const seen = new Set<string>()
    for (const page of model.pages) {
        const key = `${page.lang}:${page.path}`
        if (seen.has(key)) report_error(model.diag, where_of(page.node), `duplicate page ${page.path} (${page.lang})`)
        seen.add(key)
        if (!Object.keys(model.config.languages).includes(page.lang)) report_warning(model.diag, where_of(page.node), `language ${page.lang} is not in config.languages`)
    }
}

export function pages_in(model: site_model, lang: string): page[] {
    return model.pages.filter(page => page.lang === lang)
}

export function find_page(model: site_model, path: string, lang: string): page | undefined {
    return model.pages.find(page => page.path === path && page.lang === lang)
}

export function page_url(model: site_model, page: page): string {
    if (page.lang === model.config.default_language) return page.path
    return page.path === "/" ? `/${page.lang}` : `/${page.lang}${page.path}`
}

export function localize(model: site_model, lang: string, href: string): string {
    if (!href.startsWith("/") || href.startsWith("//")) return href
    const target = find_page(model, normalize_path(href.split("#")[0]), lang)
    if (!target) return href
    return page_url(model, target) + (href.includes("#") ? "#" + href.split("#")[1] : "")
}

export function order_pages(items: page[]): page[] {
    return [...items].sort((a, b) => {
        if (a.rank !== null && b.rank === null) return -1
        if (a.rank === null && b.rank !== null) return 1
        if (a.rank !== null && b.rank !== null && a.rank !== b.rank) return b.rank - a.rank
        return a.name.localeCompare(b.name)
    })
}

export function crumb_chain(model: site_model, current: page): page[] {
    const chain: page[] = []
    let path = current.path
    while (true) {
        const found = find_page(model, path, current.lang)
        if (found) chain.unshift(found)
        if (path === "/") break
        path = parent_path(path)
    }
    return chain
}

export function in_menu(page: page): boolean {
    return page.node.attrs.menu !== "false"
}

export function menu_pages(model: site_model, container_path: string, lang: string): page[] {
    const depth = path_depth(container_path)
    const prefix = container_path === "/" ? "/" : container_path + "/"
    const children = pages_in(model, lang).filter(page => page.path !== container_path && in_menu(page) && page.path.startsWith(prefix) && path_depth(page.path) === depth + 1)
    const self = find_page(model, container_path, lang)
    return [...(self ? [self] : []), ...order_pages(children)]
}

export function has_section(page: page, tag: string): boolean {
    return page.node.children.some(child => child.tag === tag)
}

export function section_of(page: page, tag: string): xml_node | undefined {
    return page.node.children.find(child => child.tag === tag)
}
