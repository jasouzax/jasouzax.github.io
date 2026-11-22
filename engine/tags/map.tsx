/** Map authoring metadata and indexable link fallback; desk/menu/map.ts owns interaction. */
import { jsx, fragment, type child } from "../../shared/vnode/vnode.tsx"
import type { xml_node } from "../../shared/content/xml.ts"
import { child_nodes } from "../../shared/content/xml.ts"
import type { html } from "../../shared/util.ts"
import type { render_ctx } from "./page/context.tsx"
import { glyph, link_attrs } from "./page/context.tsx"
import { ui_text } from "../load/model.ts"

export function render_map(ctx: render_ctx, node: xml_node): html {
    const nodes = (parent: xml_node): child => child_nodes(parent, "node").map(item => (
        <li data-map-node={item.attrs.id} data-map-parent={parent.tag === "node" ? parent.attrs.id : undefined} data-map-x={item.attrs.x} data-map-y={item.attrs.y}>
            <span class="desk_map_label">
                {glyph(ctx, item.attrs.icon)}
                {item.attrs.link ? <a {...link_attrs(ctx, item.attrs.link)}>{item.attrs.name ?? item.attrs.id}</a> : (item.attrs.name ?? item.attrs.id)}
            </span>
            {item.attrs.info ? <p>{item.attrs.info}</p> : null}
            {child_nodes(item, "node").length ? <ul>{nodes(item)}</ul> : null}
        </li>
    ))
    return <details class="desk_map" open data-map-layout={node.attrs.layout ?? "tree"} data-map-auto={!node.children.some(child => child.tag === "node" || child.tag === "edge") ? "" : undefined}>
        <summary>{ui_text(ctx.model, ctx.lang, "desk_map")}</summary>
        <nav aria-label={ui_text(ctx.model, ctx.lang, "desk_map")}>
            <ul>{nodes(node)}{child_nodes(node, "edge").map(edge => (
                <li data-map-from={edge.attrs.from} data-map-to={edge.attrs.to} data-map-text={edge.attrs.text}>
                    {edge.attrs.from}{" → "}{edge.attrs.to}{edge.attrs.text ? `: ${edge.attrs.text}` : ""}
                </li>
            ))}</ul>
        </nav>
    </details>
}
