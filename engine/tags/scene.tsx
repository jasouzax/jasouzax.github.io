/* Scene reading headings and build-time media projections use only authored, published content. */
import { jsx, raw_text, type child } from "../../shared/vnode/vnode.tsx"
import type { xml_node } from "../../shared/content/xml.ts"
import { make_timeline, type Scene, type Timeline } from "../../shared/blog/timeline.ts"
import { mime_from_name } from "../../shared/mime.ts"
import { published_resource, resource_text } from "../load/resources.ts"
import type { render_ctx } from "./page/context.tsx"
import { ui_text } from "../load/model.ts"
import { blog_labels } from "../../shared/blog/text.ts"

export function scene_heading(node: xml_node, depth: number): child {
    const heading = jsx(`h${Math.min(6, depth + 2)}`, {}, node.attrs.name)
    return <header class="blog_scene_heading" data-depth={depth}>{heading}{node.attrs.script || node.text.trim() ? <p>{node.attrs.script || node.text.trim()}</p> : null}{node.attrs.image?.startsWith("/assets/media/") ? <img src={node.attrs.image} alt=""/> : null}</header>
}

export function scene_timeline(ctx: render_ctx, desk: xml_node): Timeline {
    const scenes: Scene[] = []
    const published = (reference: string | undefined): string | undefined => reference && published_resource(ctx.model, reference) ? reference.replace(/^file:\/\//, "") : undefined
    const visit = (node: xml_node): void => {
        if (node.tag !== "scene") return
        const texts = node.children.filter(child => child.tag === "window").flatMap(child => {
            const mime = child.attrs.type || mime_from_name(child.attrs.path || "")
            if (!mime.startsWith("text/") && !/application\/(?:json|javascript)/.test(mime)) return []
            const text = child.attrs.data ?? resource_text(ctx.model, child.attrs.path || "")
            return text === null ? [] : [text]
        })
        scenes.push({ name: node.attrs.name, text: [node.attrs.script || node.text.trim(), ...texts].filter(Boolean).join("\n\n"),
            duration: Number(node.attrs.duration ?? 6), image: published(node.attrs.image), audio: published(node.attrs.audio),
            background: node.attrs.background || "#101827", color: node.attrs.color || "#ffffff" })
        node.children.forEach(visit)
    }
    desk.children.forEach(visit)
    return make_timeline(ctx.page.name, scenes)
}

export function scene_player(ctx: render_ctx, timeline: Timeline): child {
    if (!timeline.segments.length) return null
    const defaults = ctx.lang.startsWith("ja") ? blog_labels.ja : blog_labels.en
    const text = Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, ui_text(ctx.model, ctx.lang, key) === key ? value : ui_text(ctx.model, ctx.lang, key)]))
    const t = (key: string) => text[key]
    return <section class="blog_media needs_js" aria-label={t("blog_media")}>
        <canvas width="960" height="540" aria-label={timeline.title}/>
        <div class="blog_media_controls">
            <button type="button" data-blog-play="">{t("blog_play")}</button>
            <label>{t("blog_position")}<input data-blog-seek="" type="range" min="0" max={timeline.duration} step="0.01" value="0"/></label>
            <button type="button" data-blog-render="">{t("blog_render")}</button>
            <button type="button" data-blog-cancel="" hidden="">{t("blog_cancel")}</button>
            <output aria-live="polite" data-blog-status=""/>
        </div>
        <script type="application/json" data-blog-timeline="">{raw_text(JSON.stringify({ ...timeline, text }).replace(/[<>&]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`))}</script>
    </section>
}
