/** Print-only project research, selected by the declared print layout and exact project language.
 * Only authored, public project fields and section text are read; no account, collaborators or repository data.
 */
import { jsx, fragment, type child } from "../../../shared/vnode/vnode.tsx"
import type { xml_node } from "../../../shared/content/xml.ts"
import { child_nodes } from "../../../shared/content/xml.ts"
import { research_sections } from "../../../shared/content/schema.ts"
import { ui_text } from "../../load/model.ts"
import type { render_ctx } from "../page/context.tsx"
import { select_print } from "./model.ts"

function paragraphs(text: string): child {
    return text.trim().split(/\n\s*\n/).filter(Boolean).map(value => <p>{value.trim().replace(/\s+/g, " ")}</p>)
}

function points(node: xml_node): child {
    const children = child_nodes(node, "point")
    return children.length ? <ol>{children.map(point => <li>
        {point.attrs.name ? <strong class="research_paper_point_name">{point.attrs.name}</strong> : null}
        {paragraphs(point.text)}{points(point)}
    </li>)}</ol> : null
}

export function render_research_paper(ctx: render_ctx): child {
    const selected = select_print(ctx.model, ctx.page)
    if (!selected || (selected.attrs.layout ?? selected.attrs.name) !== "research") return null
    const project = ctx.model.objects.find(node => node.tag === "project" && node.attrs.private !== "true"
        && `/projects/${node.attrs.id}` === ctx.page.path && (node.attrs.lang ?? ctx.model.config.default_language) === ctx.lang)
    const research = project?.children.find(node => node.tag === "research")
    if (!project || !research) return null
    let source: URL | undefined
    try {
        const url = new URL(project.attrs.paper ?? "")
        if (["https:", "http:"].includes(url.protocol) && !url.username && !url.password) source = url
    } catch { /* No source link is preferable to an invalid or credential-bearing URL. */ }
    return <article class="research_paper" aria-labelledby="research_paper_title">
        <header>
            <h1 id="research_paper_title">{project.attrs.name}</h1>
            {project.attrs.date ? <p class="research_paper_date">{project.attrs.date}</p> : null}
            {source ? <p class="research_paper_source"><a href={source.href}>{ui_text(ctx.model, ctx.lang, "research_paper_source")}{": "}{source.hostname}</a></p> : null}
        </header>
        {Object.keys(research_sections).flatMap(tag => {
            const section = child_nodes(research, tag)[0]
            if (!section) return []
            return [<section class="research_paper_section" data-research-section={tag}>
                <h2>{ui_text(ctx.model, ctx.lang, `research_${tag}`)}</h2>
                {paragraphs(section.text)}{points(section)}
            </section>]
        })}
    </article>
}
