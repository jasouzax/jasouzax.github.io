/** A book is a print-only projection of published blog pages, never runtime desk state. */
import { jsx, fragment, type child } from "../../../shared/vnode/vnode.tsx"
import { markdown_nodes } from "../../../shared/markdown.ts"
import { mime_from_name } from "../../../shared/mime.ts"
import { resource_text, published_resource } from "../../load/resources.ts"
import { localize, ui_text, type page } from "../../load/model.ts"
import type { xml_node } from "../../../shared/content/xml.ts"
import type { render_ctx } from "../page/context.tsx"
import { select_print } from "./model.ts"
import { parse_notebook, notebook_mime } from "../../../shared/notebook.ts"
import { notebook_cell_content } from "../../../shared/notebook/render.tsx"

function prose(ctx: render_ctx, source: string, title: string, path: string): child {
    const nodes = markdown_nodes(source)
    const plain = (node: child): string => Array.isArray(node) ? node.map(plain).join("") : node && typeof node === "object" ? "children" in node ? node.children.map(plain).join("") : node.literal_text : typeof node === "string" || typeof node === "number" ? String(node) : ""
    const first = nodes.findIndex(node => node && typeof node === "object" && "tag" in node)
    const heading = nodes[first]
    if (heading && typeof heading === "object" && "tag" in heading && heading.tag === "h1" && plain(heading).trim() === title.trim()) nodes.splice(first, 1)
    const demote = (node: child): void => {
        if (Array.isArray(node)) node.forEach(demote)
        else if (node && typeof node === "object" && "tag" in node) {
            if (/^h[1-6]$/.test(node.tag ?? "")) node.tag = `h${Math.min(6, Number(node.tag![1]) + 2)}`
            if (node.tag === "img" || node.tag === "a") {
                const key = node.tag === "img" ? "src" : "href", reference = String(node.attrs[key] ?? "")
                try {
                    const url = new URL(reference, new URL(path.replace(/^file:\/\//, "") || `${ctx.page.path}/`, ctx.model.config.base_url))
                    if (url.username || url.password || !["https:", "http:", "mailto:", "tel:"].includes(url.protocol)) throw new Error("Unsafe book link")
                    if (node.tag === "img") {
                        if (url.origin !== new URL(ctx.model.config.base_url).origin || !published_resource(ctx.model, url.pathname)) throw new Error("Unpublished book image")
                        node.attrs.src = url.pathname + url.hash
                    } else if (!reference.startsWith("#")) node.attrs.href = url.href
                } catch {
                    if (node.tag === "img") { node.children = [String(node.attrs.alt ?? "")]; node.tag = null; node.attrs = {} }
                    else delete node.attrs.href
                }
            }
            node.children.forEach(demote)
        }
    }
    nodes.forEach(demote)
    return nodes
}

function window_content(ctx: render_ctx, node: xml_node, title: string): child {
    const path = node.attrs.path ?? "", mime = node.attrs.type || mime_from_name(path)
    // Inline text or already-published content only: no process, network, home or server reads.
    const is_text = mime.startsWith("text/") || /^application\/(?:.*json|javascript|.*xml)$/.test(mime)
    const source = is_text ? node.attrs.data ?? resource_text(ctx.model, path) : null
    if (source !== null) {
        if (mime === notebook_mime) {
            try { return <div class="book_notebook">{parse_notebook(source).cells.map(cell => <section class="notebook_cell">{notebook_cell_content(cell, 2)}</section>)}</div> }
            catch { return <pre><code>{source}</code></pre> }
        }
        return mime === "text/markdown" ? <div class="book_prose">{prose(ctx, source, title, path)}</div> : <pre><code>{source}</code></pre>
    }
    const url = path.replace(/^file:\/\//, "")
    if (mime.startsWith("image/") && published_resource(ctx.model, path)) return <figure><img src={url} alt={node.attrs.name ?? ""}/></figure>
    // Dynamic/executable windows stay interactive on the website, never execute while printing.
    return null
}

export function book_chapters(ctx: render_ctx): page[] {
    if (!/^\/blogs(?:\/|$)/.test(ctx.page.path)) return []
    return ctx.model.pages.filter(page => page.lang === ctx.lang && !page.noindex
        && page.node.attrs.private !== "true" && (page.path === ctx.page.path || page.path.startsWith(`${ctx.page.path}/`))
        && page.path !== "/blogs" && /^\/blogs\//.test(page.path))
}

export function render_book(ctx: render_ctx): child {
    const selected = select_print(ctx.model, ctx.page)
    if (!selected || (selected.attrs.layout ?? selected.attrs.name) !== "book") return null
    const chapters = book_chapters(ctx)
    if (!chapters.length) return null
    return <article class="blog_book" aria-labelledby="book_title">
        <header class="book_cover"><h1 id="book_title">{ctx.page.name}</h1>{ctx.page.info ? <p>{ctx.page.info}</p> : null}</header>
        <nav class="book_contents" aria-label={ui_text(ctx.model, ctx.lang, "book_contents")}>
            <h2>{ui_text(ctx.model, ctx.lang, "book_contents")}</h2>
            <ol>{chapters.map((page, index) => <li><a href={`#book_chapter_${index + 1}`}>{page.name}</a></li>)}</ol>
        </nav>
        {chapters.map((page, index) => <section class="book_chapter" id={`book_chapter_${index + 1}`}>
            <header><p class="book_chapter_number">{index + 1}</p><h2>{page.name}</h2>
                {page.node.attrs.date ? <p>{page.node.attrs.date}</p> : null}
                <p class="book_source"><a href={new URL(localize(ctx.model, ctx.lang, page.path), ctx.model.config.base_url).href}>{ui_text(ctx.model, ctx.lang, "book_source")}</a></p>
            </header>
            {page.node.children.filter(node => node.tag === "desk").flatMap(desk => desk.children.filter(node => node.tag === "window" && node.attrs.private !== "true").map(node => window_content(ctx, node, page.name)))}
        </section>)}
    </article>
}
