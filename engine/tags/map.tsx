import { jsx, fragment, type child } from "../../shared/vnode/vnode.tsx"
import type { xml_node } from "../../shared/content/xml.ts"
import { child_nodes } from "../../shared/content/xml.ts"
import type { html } from "../../shared/util.ts"
import type { render_ctx } from "./page/context.tsx"
import { link_attrs } from "./page/context.tsx"

export function render_map(ctx: render_ctx, node: xml_node): html {
    const nodes = (parent: xml_node): child =>
        child_nodes(parent, "node").map((item) => (
            <>
                <li>
                    {item.attrs.link ? (
                        <>
                            <a {...link_attrs(ctx, item.attrs.link)}>{item.attrs.name ?? item.attrs.id}</a>
                        </>
                    ) : (
                        (item.attrs.name ?? item.attrs.id)
                    )}
                    {item.children.length ? (
                        <>
                            <ul>{nodes(item)}</ul>
                        </>
                    ) : (
                        ""
                    )}
                </li>
            </>
        ))
    const edges = child_nodes(node, "edge").map((edge) => (
        <>
            <li>
                {edge.attrs.from}
                {" → "}
                {edge.attrs.to}
                {edge.attrs.text ? `: ${edge.attrs.text}` : ""}
            </li>
        </>
    ))
    return (
        <>
            <details class={"desk_map"} open={""}>
                <summary>{"Map"}</summary>
                <nav aria-label={"Map"}>
                    <ul>
                        {nodes(node)}
                        {edges}
                    </ul>
                </nav>
            </details>
        </>
    )
}
