import { jsx, fragment, type child } from "../../shared/vnode/vnode.tsx"
import type { xml_node } from "../../shared/content/xml.ts"
import { glyph, link_attrs, type render_ctx } from "./page/context.tsx"

export function render_action(ctx: render_ctx, action: xml_node, kind: "hero" | "foot" = "hero"): child {
    if (kind === "foot") return <a {...link_attrs(ctx, action.attrs.link)}>{glyph(ctx, action.attrs.icon)}{action.attrs.text}</a>
    return <a class={`landing_btn${action.attrs.primary === "true" ? " primary" : ""}`} {...link_attrs(ctx, action.attrs.link)}><span>{action.attrs.text}</span>{glyph(ctx, action.attrs.icon, "landing_btn_icon")}</a>
}
