import { render_item } from "./item.tsx"
import { render_action } from "./action.tsx"
import { jsx, fragment, type child } from "../../shared/vnode/vnode.tsx"
import { child_nodes, type xml_node } from "../../shared/content/xml.ts"
import type { render_ctx } from "./page/context.tsx"
import { t, glyph } from "./page/context.tsx"
import { split_list } from "../../shared/util.ts"
import { resume_format_of } from "./print/rirekisho.tsx"

export function render_hero(ctx: render_ctx, node: xml_node, next_id = ""): child {
    const index = ctx.page.node.children.filter((child) => child.tag === "hero").indexOf(node)
    const id = index === 0 ? "home" : index === 1 ? "contact" : `hero_${index}`
    const title = `${id}_title`
    const roles = split_list(node.attrs.tags)
    const items = child_nodes(node, "item")
    const form = resume_format_of(ctx)
    const heading = jsx(
        index === 0 ? "h1" : "h2",
        { id: title, class: "landing_name" },
        node.attrs.name ?? ""
    )
    return (
        <article class="landing article" id={id} aria-labelledby={title}>
            <div class="landing_panel">
                {heading}
                {roles.length > 0 && (
                    <p class="landing_job" aria-label={roles.join(", ")}>
                        <span class="landing_prompt" aria-hidden="true">
                            &gt;
                        </span>
                        <span class="landing_roles" style={`--role_count:${roles.length}`} aria-hidden="true">
                            {roles.map((role, i) => (
                                <span class="landing_role" style={`--role_index:${i}`}>
                                    <span class="landing_role_text">{role}</span>
                                </span>
                            ))}
                        </span>
                    </p>
                )}
                <p class="landing_lead">{node.attrs.info ?? ""}</p>
                <ul class="landing_contacts" aria-label={t(ctx, "contact")}>
                    {items.map(item => render_item(ctx, item))}
                </ul>
                <div class="landing_actions">
                    {child_nodes(node, "action").map(action => render_action(ctx, action))}
                </div>
            </div>
            {next_id && (
                <a class="landing_scroll" href={`#${next_id}`} aria-label={t(ctx, "scroll_to")}>
                    <span>{t(ctx, "scroll")}</span>
                    {glyph(ctx, "[arrow_down]", "landing_scroll_icon")}
                </a>
            )}
            {index === 0 && form.node && form.format === "international" && (
                <div class="landing_resume" hidden>
                    <p class="resume_name">{node.attrs.name ?? ""}</p>
                    <p class="resume_contacts">
                        {items
                            .filter((item) => item.attrs.print === "true")
                            .map((item) => (
                                <span class="resume_contact">{item.attrs.text ?? ""}</span>
                            ))}
                    </p>
                </div>
            )}
        </article>
    )
}
