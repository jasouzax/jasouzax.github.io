/* Event desk navigation, preserving authored nested periods. */
import type { xml_node } from "../../shared/content/xml.ts"
import { element } from "./objects.ts"

export function event_children(object: xml_node, children: xml_node[]): void {
    const entries = (nodes: xml_node[]): xml_node[] => nodes.filter(node => node.tag === "event").map(node =>
        element("entry", { name: node.attrs.name, info: node.attrs.info ?? "", date: node.attrs.date ?? "", type: "Note" }, node, entries(node.children)))
    children.unshift(element("menu", { name: "Events" }, object, entries(object.children)))
}
