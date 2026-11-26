import { render_entry } from "./entry.tsx"
import { render_map } from "./map.tsx"
import { render_foot } from "./foot.tsx"
import { jsx, fragment } from "../../shared/vnode/vnode.tsx"
import type { xml_node } from "../../shared/content/xml.ts"
import { child_nodes } from "../../shared/content/xml.ts"
import type { html } from "../../shared/util.ts"
import type { render_ctx } from "./page/context.tsx"
import { glyph, icon } from "./page/context.tsx"
import { ui_text } from "../load/model.ts"

export function render_side_head(ctx: render_ctx, desk: xml_node): html {
    const sides = child_nodes(desk, "menu")
    const tabs = sides.map((side, index) => (
        <>
            <li>
                <details class={"desk_side_tabs_drop"} name={"desk_side_tab"} data-path={side.attrs.path} open={index === 0}>
                    <summary>
                        {glyph(ctx, side.attrs.icon ?? "[file]")}
                        {side.attrs.name ?? ""}
                    </summary>
                </details>
            </li>
        </>
    ))
    return (
        <>
            <header class={"desk_side_head"}>
                {glyph(ctx, desk.attrs.icon, "desk_side_icon")}
                <h2 class={"desk_side_name"}>{desk.attrs.name ?? ""}</h2>
                <button type="button" class="desk_side_mode needs_js" aria-pressed="false" aria-label={ui_text(ctx.model, ctx.lang, "desk_map")} title={ui_text(ctx.model, ctx.lang, "desk_map")} disabled><svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M14 3H3v18h18V10M12 12L21 3M15 3h6v6" fill="none" stroke="currentColor" stroke-width="2"/></svg></button>
                <p class={"desk_side_info"}>{desk.attrs.info ?? ""}</p>
                <nav class={"desk_side_tabs"}>
                    <ul class={"desk_side_tabs_ul"}>{tabs}</ul>
                </nav>
            </header>
        </>
    )
}

export function render_menu(ctx: render_ctx, side: xml_node, index: number): html {
    const path = side.attrs.path ?? ""
    const prefix = `https://repo.${new URL(ctx.model.config.base_url).hostname}/`
    const version = path.startsWith(prefix) && /^[a-z0-9-]+\/_\/log$/.test(path.slice(prefix.length)) ? path : undefined
    return <div role="feed" class="desk_side_page" data-path={side.attrs.path} data-version-url={version}>
        {child_nodes(side, "entry").map(entry => render_entry(ctx, entry, index))}
        {child_nodes(side, "map").map(map => render_map(ctx, map))}
        {child_nodes(side, "foot").map(foot => render_foot(ctx, foot))}
    </div>
}
