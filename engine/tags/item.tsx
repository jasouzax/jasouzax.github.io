import { jsx, fragment, type child } from "../../shared/vnode/vnode.tsx"
import type { xml_node } from "../../shared/content/xml.ts"
import { glyph, link_attrs, type render_ctx } from "./page/context.tsx"

export function render_item(ctx: render_ctx, item: xml_node): child {
    const body = <>{glyph(ctx, item.attrs.icon, "landing_contact_icon")}<span class="landing_contact_type">{item.attrs.name ?? ""}</span><span class="landing_contact_value">{item.attrs.text ?? ""}</span></>
    return <li>{item.attrs.link ? <a class="landing_contact" {...link_attrs(ctx, item.attrs.link)}>{body}</a> : <span class="landing_contact">{body}</span>}</li>
}
