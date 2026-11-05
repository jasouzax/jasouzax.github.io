import { jsx, fragment, type child } from "./vnode.tsx"
import { child_nodes, type xml_node } from "../xml.ts"
import type { render_ctx } from "./html_common.tsx"
import { t, glyph, link_attrs } from "./html_common.tsx"
import { split_list } from "../util.ts"
import { resume_format_of } from "./html_rirekisho.tsx"

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
                {node.attrs.status && (
                    <p class="landing_status">
                        <span class="landing_dot" aria-hidden="true" />
                        {node.attrs.status}
                    </p>
                )}
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
                {node.attrs.profile && (
                    <img class="hero_profile" src={node.attrs.profile} alt={node.attrs.name ?? ""} />
                )}
                <p class="landing_lead">{node.attrs.info ?? ""}</p>
                <ul class="landing_contacts" aria-label={t(ctx, "contact")}>
                    {items.map((item) => {
                        const body = (
                            <>
                                {glyph(ctx, item.attrs.icon, "landing_chip_icon")}
                                <span class="landing_chip_type">{item.attrs.name ?? ""}</span>
                                <span class="landing_chip_value">{item.attrs.text ?? ""}</span>
                            </>
                        )
                        return (
                            <li>
                                {item.attrs.link ? (
                                    <a class="landing_chip" {...link_attrs(ctx, item.attrs.link)}>
                                        {body}
                                    </a>
                                ) : (
                                    <span class="landing_chip">{body}</span>
                                )}
                            </li>
                        )
                    })}
                </ul>
                <div class="landing_actions">
                    {child_nodes(node, "action").map((action) => (
                        <a
                            class={`landing_btn${action.attrs.primary === "true" ? " primary" : ""}`}
                            {...link_attrs(ctx, action.attrs.link)}
                        >
                            <span>{action.attrs.text}</span>
                            {glyph(ctx, action.attrs.icon, "landing_btn_icon")}
                        </a>
                    ))}
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
                            .filter((item) => item.attrs.print)
                            .map((item) => (
                                <span class="resume_contact">{item.attrs.text ?? ""}</span>
                            ))}
                    </p>
                </div>
            )}
        </article>
    )
}
