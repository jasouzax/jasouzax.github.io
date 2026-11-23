/* Public project desk: files, research and repository history. */
import type { xml_node } from "../../shared/content/xml.ts"
import type { site_model } from "../load/model.ts"
import { research_sections } from "../../shared/content/schema.ts"
import { element } from "./objects.ts"
import { pipeline_children } from "./project/pipeline.ts"

export function project_children(model: site_model, object: xml_node, children: xml_node[]): void {
const id = object.attrs.id
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
    children.push(element("menu", { name: "Version", path: `https://repo.${new URL(model.config.base_url).hostname}/${id}/_/log` }, object))
    pipeline_children(model, object, children)
}
