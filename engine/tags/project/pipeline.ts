/* Copy only explicitly authored public UI, never execution steps or credential declarations. */
import type { xml_node } from "../../../shared/content/xml.ts"
import { element } from "../objects.ts"
import { ui_text, type site_model } from "../../load/model.ts"

function copy_ui(source: xml_node): xml_node {
    const node = { ...source, attrs: { ...source.attrs }, children: source.children.map(copy_ui), parent: null }
    for (const child of node.children) child.parent = node
    return node
}

export function pipeline_children(model: site_model, project: xml_node, children: xml_node[]): void {
    for (const pipeline of project.children.filter(node => node.tag === "pipeline")) {
        const offset = children.filter(node => node.tag === "window").length
        const actions: xml_node[] = []
        for (const source of pipeline.children) {
            if (!["menu", "window", "action"].includes(source.tag)) continue
            const node = copy_ui(source)
            if (node.tag === "action") actions.push(node)
            else {
                if (node.tag === "window" && node.attrs.split) node.attrs.split = String(offset + Number(node.attrs.split))
                children.push(node)
            }
        }
        if (actions.length) children.push(element("menu", {
            name: `${ui_text(model, project.attrs.lang ?? model.config.default_language, "pipeline_actions")}: ${pipeline.attrs.branch ?? "master"}`,
        }, pipeline, [element("foot", {}, pipeline, actions)]))
    }
}
