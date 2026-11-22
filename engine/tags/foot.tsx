import { jsx, type child } from "../../shared/vnode/vnode.tsx"
import { child_nodes, type xml_node } from "../../shared/content/xml.ts"
import type { render_ctx } from "./page/context.tsx"
import { render_action } from "./action.tsx"

export function render_foot(ctx: render_ctx, foot: xml_node): child {
    return <nav class="desk_menu_foot">{child_nodes(foot, "action").map(action => render_action(ctx, action, "foot"))}</nav>
}
