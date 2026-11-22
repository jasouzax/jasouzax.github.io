import { jsx, fragment, type child } from "../../shared/vnode/vnode.tsx"
import type { xml_node } from "../../shared/content/xml.ts"
import { child_nodes } from "../../shared/content/xml.ts"
import type { html } from "../../shared/util.ts"
import type { render_ctx } from "./page/context.tsx"
import { glyph, icon, link_attrs } from "./page/context.tsx"
import { is_true } from "../../shared/content/schema.ts"
import { mime_from_name, mime_info_of } from "../../shared/mime.ts"

export function entry_kind(type: string): string {
    const key = type.toLowerCase()
    if (["folder", "dir", "directory"].includes(key)) return "dir"
    if (key === "file") return "file"
    if (["share", "boost"].includes(key)) return "share"
    return "post"
}

export function render_entry(ctx: render_ctx, node: xml_node, side_index: number): html {
    const attrs = node.attrs
    const kind = entry_kind(attrs.type ?? "Post")
    const id = attrs.id ?? `${side_index}_${node.line}`
    const default_icon =
        kind === "dir"
            ? "[folder]"
            : kind === "file"
              ? (mime_info_of(mime_from_name(attrs.name ?? ""))?.icon ?? "[file]")
              : "[file]"
    const icon_html = attrs.image ? (
        <>
            <img class={"desk_side_item_icon"} src={attrs.image} alt={""} />
        </>
    ) : (
        glyph(ctx, attrs.icon ?? default_icon, "desk_side_item_icon")
    )
    const entry_name = attrs.link ? (
        <>
            <a {...link_attrs(ctx, attrs.link)}>{attrs.name ?? ""}</a>
        </>
    ) : (
        (attrs.name ?? "")
    )
    const head = (
        <>
            <summary class={"desk_side_item_head"}>
                {icon_html}
                <h3 class={"desk_side_item_name"}>{entry_name}</h3>
                {attrs.from ? (
                    <>
                        <span class={"desk_side_item_code"}>{attrs.from}</span>
                    </>
                ) : (
                    ""
                )}
                {attrs.date ? (
                    <>
                        <span class={"desk_side_item_date"}>{attrs.date}</span>
                    </>
                ) : (
                    ""
                )}
            </summary>
        </>
    )
    const body = attrs.data ? (
        <>
            <div class={"desk_side_item_body"}>{attrs.data}</div>
        </>
    ) : (
        ""
    )
    const info = attrs.info ? (
        <>
            <p class={"desk_side_item_info"}>{attrs.info}</p>
        </>
    ) : (
        ""
    )
    const acts = (attrs.acts ?? "")
        .split(",")
        .map((act) => act.trim())
        .filter((act) => act.length > 0)
    const tool =
        acts.length > 0 ? (
            <>
                <div class={"desk_side_item_tool"}>
                    {acts.map((act) => (
                        <>
                            <button type={"button"}>{act}</button>
                        </>
                    ))}
                </div>
            </>
        ) : (
            ""
        )
    const children = child_nodes(node, "entry")
    const sub =
        children.length > 0 ? (
            <>
                <ul id={`items-${id}`} class={"desk_side_item_sub"}>
                    {children.map((child) => (
                        <>
                            <li>{render_entry(ctx, child, side_index)}</li>
                        </>
                    ))}
                </ul>
            </>
        ) : (
            ""
        )
    const open = is_true(attrs.open) || (kind === "dir" && children.length > 0)
    return (
        <>
            <article class={"desk_side_item"} data-kind={kind} data-entry-id={id}>
                <details class={"desk_side_item_box"} open={open}>
                    {head}
                    {body}
                    {info}
                    {tool}
                    {sub}
                </details>
            </article>
        </>
    )
}
