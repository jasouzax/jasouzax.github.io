import { existsSync, statSync, readFileSync, realpathSync } from "node:fs"
import { dirname, resolve, relative, basename, sep, extname } from "node:path"
import type { xml_node } from "./xml.ts"
import { walk_nodes, where_of } from "./xml.ts"
import type { site_model, page } from "./model.ts"
import { report_error, report_warning } from "./diag.ts"
import { split_list, short_hash } from "./util.ts"
import { inside } from "./paths.ts"
import { research_sections } from "./schema.ts"

export function element(tag: string, attrs: Record<string, string>, source: xml_node, children: xml_node[] = []): xml_node {
    const node: xml_node = { tag, attrs, children, text: "", file: source.file, line: source.line, parent: null }
    for (const child of children) child.parent = node
    return node
}

// A project's public summary comes from its featured (or first public) slide.
export function object_info(node: xml_node): string {
    if (node.tag !== "project") return node.attrs.info ?? ""
    const slides = node.children.filter(child => child.tag === "slide" && child.attrs.private !== "true")
    const slide = slides.find(child => child.attrs.featured === "true") ?? slides[0]
    return slide ? slide.attrs.info ?? slide.attrs.description ?? slide.text.trim() : ""
}

function page_of(model: site_model, node: xml_node): page {
    return { path: node.attrs.path, lang: node.attrs.lang ?? model.config.default_language, name: node.attrs.name,
        info: node.attrs.info ?? "", rank: node.attrs.rank === undefined ? null : Number(node.attrs.rank),
        noindex: node.attrs.noindex === "true", icon: node.attrs.icon ?? "", node, file: relative(model.root, node.file) }
}

export function expand_objects(model: site_model): void {
    // Private objects never reach pages, navigation, search, resource publishing or expertise.
    model.objects = model.objects.filter(node => node.attrs.private !== "true")
    for (const object of model.objects) {
        object.children = object.children.filter(node => node.attrs.private !== "true")
        const id = object.attrs.id
        if (!/^[a-z0-9][a-z0-9_-]*$/.test(id ?? "")) {
            report_error(model.diag, where_of(object), "id must be a safe URL segment")
            continue
        }
        const path = `/${object.tag}s/${id}`
        const info = object_info(object)
        const children = object.children.filter(node => ["menu", "window"].includes(node.tag))
        if (object.tag === "event") {
            const entries = (nodes: xml_node[]): xml_node[] => nodes.filter(node => node.tag === "event").map(node =>
                element("entry", { name: node.attrs.name, info: node.attrs.info ?? "", date: node.attrs.date ?? "", type: "Note" }, node, entries(node.children)))
            children.unshift(element("menu", { name: "Events" }, object, entries(object.children)))
        }
        if (object.tag === "project") {
            const folder = (name: string, children: xml_node[] = []): xml_node =>
                element("entry", { name, type: "Folder" }, object, children)
            const root = folder("/", ["bin", "boot", "dev", "etc", "home", "lib", "media", "mnt", "opt", "proc", "root", "run", "sbin", "srv", "sys", "tmp", "usr", "var"].map(name =>
                folder(name, name === "home" ? [folder("user")] : name === "srv" ? [folder("projects", [folder(id)])] : [])))
            children.unshift(element("menu", { name: "Files", path: "file:///" }, object, [root]))
            const research = object.children.find(node => node.tag === "research")
            if (research) {
                const point = (node: xml_node, name = node.attrs.name): xml_node => element("entry", {
                    name, type: "Post", data: node.text.trim(),
                }, node, node.children.filter(child => child.tag === "point").map(child => point(child)))
                const sections = Object.entries(research_sections).map(([tag, name]) => {
                    const section = research.children.find(node => node.tag === tag)
                    return section ? point(section, name) : element("entry", { name, type: "Post" }, research)
                })
                children.splice(1, 0, element("menu", { name: "Overview" }, research, sections))
            }
            children.push(element("menu", { name: "Version", path: `/api/v1/git/${id}/log` }, object))
        }
        if (!children.some(node => node.tag === "window")) children.push(element("window", object.tag === "project" ? {
            type: "inode/directory", mode: "view", path: `file:///srv/projects/${id}`,
        } : {
            type: "text/markdown", mode: "view", data: info || object.attrs.name,
        }, object))
        const desk = element("desk", {
            name: object.tag === "project" ? object.attrs.short ?? object.attrs.name : object.attrs.name,
            info: object.tag === "project" ? object.attrs.note ?? "" : info,
            auto: "true",
            ...(object.tag === "project" ? { cwd: `/srv/projects/${id}` } : {}),
        }, object, children)
        const node = element("page", { ...object.attrs, info, path }, object, [desk])
        model.pages.push(page_of(model, node))
    }
    for (const lang of Object.keys(model.config.languages)) {
        for (const kind of ["project", "blog"] as const) {
            const path = `/${kind}s`
            if (model.pages.some(page => page.path === path && page.lang === lang)) continue
            const objects = model.objects.filter(node => node.tag === kind && node.attrs.lang === lang)
            const source = objects[0] ?? model.pages[0]?.node
            if (!source) continue
            const name = kind === "project" ? "Projects" : "Blogs"
            const entries = objects.map(node => element("entry", { name: node.attrs.name, info: object_info(node),
                type: kind === "blog" ? "Post" : "Folder", link: `${path}/${node.attrs.id}` }, node))
            const map = element("map", { layout: "tree" }, source, objects.map(node => element("node", {
                id: node.attrs.id, name: node.attrs.name, link: `${path}/${node.attrs.id}`,
            }, node)))
            const menu = element("menu", { name }, source, [...entries, map])
            const desk = element("desk", { name, auto: "true" }, source, [menu])
            model.pages.push(page_of(model, element("page", { path, lang, name, info: `Browse ${name.toLowerCase()}.` }, source, [desk])))
        }
    }
    // Root events feed expertise; the author supplies vocabulary only.
    for (const page of model.pages) {
        for (const expertise of page.node.children.filter(node => node.tag === "expertise")) {
            const events = model.objects.filter(node => node.tag === "event" && node.attrs.lang === page.lang)
            // The existing timeline uses periods as contextual filters as well as skills.
            expertise.children.push(...events.map(node => ({ ...node, attrs: { ...node.attrs, resume: ["education", "experience"].includes(node.attrs.type) ? node.attrs.type : "" } })))
        }
    }
}

export function collect_resources(model: site_model): void {
    const base = resolve(model.content_dir)
    function publish(node: xml_node, value: string, owner: string, window: boolean): string {
        if (/^(?:https?:|mailto:|data:|window:|pid:|shell:|#)/.test(value) || value.startsWith("/api/")) return value
        if (value === "file:///" || value.startsWith("file:///home/user")) return value
        if (model.resources.has(value.replace(/^file:\/\//, ""))) return value
        let source: string
        let url: string
        if (value.startsWith("file:///srv/")) return value
        if (value.startsWith("/")) { source = resolve(base, value.slice(1)); url = value }
        else { source = resolve(dirname(node.file), value); url = `${owner}/${basename(value)}` }
        const rel = relative(base, source)
        if (rel === ".." || rel.startsWith(`..${sep}`) || resolve(source) === base) {
            report_error(model.diag, where_of(node), `resource escapes content: ${value}`)
            return value
        }
        if (!existsSync(source) || !statSync(source).isFile()) {
            report_warning(model.diag, where_of(node), `missing resource ${value}`)
            return value
        }
        if (!inside(realpathSync(base), realpathSync(source))) {
            report_error(model.diag, where_of(node), `resource symlink escapes content: ${value}`)
            return value
        }
        if (model.resources.has(url) && model.resources.get(url) !== source) report_error(model.diag, where_of(node), `resource collision at ${url}`)
        if (!window && /\.(?:png|jpg|jpeg|avif|webp|gif|svg|mp4|webm|mp3|ogg|wav)$/i.test(source)) url = `/assets/media/${short_hash(readFileSync(source))}${extname(source).toLowerCase()}`
        model.resources.set(url, source)
        return window ? `file://${url}` : url
    }
    for (const page of [...model.pages, ...model.objects.map(node => ({ path: `/${node.tag}s/${node.attrs.id}`, node }))]) {
        const owner = `/srv/${page.path === "/" ? "pages/home" : page.path.slice(1)}`
        walk_nodes(page.node, node => {
            for (const key of ["media", "poster", "image", "profile", "cover", "photo"]) {
                if (node.attrs[key]) node.attrs[key] = publish(node, node.attrs[key], owner, false)
            }
            if (node.tag === "window" && node.attrs.path) node.attrs.path = publish(node, node.attrs.path, owner, true)
        })
    }
}
