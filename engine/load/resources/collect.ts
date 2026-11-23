/* Discover and publish authored resources while enforcing content and privacy boundaries. */
import { existsSync, statSync, readFileSync, realpathSync } from "node:fs"
import { dirname, resolve, relative, basename, sep, extname } from "node:path"
import type { xml_node } from "../../../shared/content/xml.ts"
import { where_of } from "../../../shared/content/xml.ts"
import type { site_model, page } from "../model.ts"
import { report_error, report_warning } from "../../../shared/diag.ts"
import { short_hash } from "../../../shared/util.ts"
import { inside } from "../../../shared/paths.ts"
import { blog_id } from "../../tags/blog.tsx"

export function collect_resources(model: site_model): void {
    const base = resolve(model.content_dir)
    function publish(node: xml_node, value: string, owner: string, window: boolean): string {
        if (/^(?:https?:|mailto:|im:|data:|window:|pid:|shell:|server:|#)/.test(value) || value.startsWith("/api/")) return value
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
    for (const page of [...model.pages, ...model.objects.map(node => ({ path: `/${node.tag}s/${node.tag === "blog" ? blog_id(node) : node.attrs.id}`, node }))]) {
        const owner = `/srv/${page.path === "/" ? "pages/home" : page.path.slice(1)}`
        const owned_nodes = (node: xml_node, visit: (node: xml_node) => void): void => {
            visit(node)
            for (const child of node.children) if (child.tag !== "blog") owned_nodes(child, visit)
        }
        owned_nodes(page.node, node => {
            for (const key of ["media", "poster", "image", "profile", "cover", "photo", "audio"]) {
                if (node.attrs[key]) node.attrs[key] = publish(node, node.attrs[key], owner, false)
            }
            if (node.tag === "window" && page.node.attrs.confidental === "true" && !/^(?:image|audio|video)\//.test(node.attrs.type ?? "")) {
                node.attrs.path = `file://${owner}`
                node.attrs.type = "inode/directory"
                delete node.attrs.data
            } else if (node.tag === "window" && node.attrs.path) node.attrs.path = publish(node, node.attrs.path, owner, true)
        })
    }
}
