import { project_children } from "./project.tsx"
import { event_children } from "./event.tsx"
import { blog_id, public_blogs } from "./blog.tsx"
import { valid_subdomain_id } from "../../shared/content/ids.ts"
import { relative } from "node:path"
import type { xml_node } from "../../shared/content/xml.ts"
import { where_of } from "../../shared/content/xml.ts"
import type { site_model, page } from "../load/model.ts"
import { report_error } from "../../shared/diag.ts"

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
    return slide ? slide.attrs.info ?? slide.text.trim() : ""
}

function page_of(model: site_model, node: xml_node): page {
    return { path: node.attrs.path, lang: node.attrs.lang ?? model.config.default_language, name: node.attrs.name,
        info: node.attrs.info ?? "", rank: node.attrs.rank === undefined ? null : Number(node.attrs.rank),
        noindex: node.attrs.noindex === "true", icon: node.attrs.icon ?? "", node, file: relative(model.root, node.file) }
}

export function expand_objects(model: site_model): void {
    // Private objects never reach pages, navigation, search, resource publishing or expertise.
    model.objects = model.objects.filter(node => node.attrs.private !== "true").flatMap(node => node.tag === "blog" ? public_blogs(node, model.config.default_language) : [node])
    for (const object of model.objects) {
        object.children = object.children.filter(node => node.attrs.private !== "true")
        const id = object.attrs.id
        if (object.tag === "project" ? !valid_subdomain_id(id) : object.tag === "blog" ? !blog_id(object).split("/").every(part => /^[a-z0-9][a-z0-9_-]*$/.test(part)) : !/^[a-z0-9][a-z0-9_-]*$/.test(id ?? "")) {
            report_error(model.diag, where_of(object), "id must be a safe URL segment")
            continue
        }
        const path = `/${object.tag}s/${object.tag === "blog" ? blog_id(object) : id}`
        const info = object_info(object)
        const children = object.children.filter(node => ["menu", "window"].includes(node.tag))
        if (object.tag === "event") event_children(object, children)
        if (object.tag === "project") project_children(model, object, children)
        if (!children.some(node => node.tag === "window")) children.push(element("window", object.tag === "project" ? {
            type: "inode/directory", view: "true", path: `file:///srv/projects/${id}`,
        } : {
            type: "text/markdown", view: "true", data: info || object.attrs.name,
        }, object))
        const desk = element("desk", {
            name: object.tag === "project" ? object.attrs.short ?? object.attrs.name : object.attrs.name,
            info: object.tag === "project" ? object.attrs.note ?? "" : info,
            auto: "true",
            ...(object.tag === "project" ? { cwd: `/srv/projects/${id}` } : {}),
        }, object, children)
        const { repo: _server_repo, collaborators: _server_collaborators, ...public_attrs } = object.attrs
        const node = element("page", { ...public_attrs, info, path }, object, [desk])
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
                type: kind === "blog" ? "Post" : "Folder", link: `${path}/${kind === "blog" ? blog_id(node) : node.attrs.id}` }, node))
            const map = element("map", { layout: "tree" }, source, objects.map(node => element("node", {
                id: kind === "blog" ? blog_id(node) : node.attrs.id, name: node.attrs.name, link: `${path}/${kind === "blog" ? blog_id(node) : node.attrs.id}`,
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
            expertise.children.push(...events.map(node => ({ ...node, attrs: { ...node.attrs, resume: node.attrs.resume ?? (["education", "experience"].includes(node.attrs.type) ? node.attrs.type : "") } })))
        }
    }
}
