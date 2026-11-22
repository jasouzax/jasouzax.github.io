/* Feed entries come only from public, indexable blog pages in the requested language. */
import type { site_model } from "../load/model.ts"
import { page_url } from "../load/model.ts"

export const xml_text = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[char]!))
export const feed_path = (model: site_model, lang: string, kind: "rss" | "atom") => `${lang === model.config.default_language ? "" : `/${lang}`}/blogs/${kind}.xml`

export function blog_entries(model: site_model, lang: string) {
    return model.pages.filter(page => page.lang === lang && page.path.startsWith("/blogs/") && !page.noindex && page.node.attrs.private !== "true").map(page => {
        const date = page.node.attrs.date
        const parsed = date && /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(date) ? Date.parse(date) : NaN
        return { title: page.name, summary: page.info, url: new URL(page_url(model, page), model.config.base_url).href, date: Number.isFinite(parsed) ? new Date(parsed) : model.build_date }
    }).sort((a, b) => b.date.getTime() - a.date.getTime() || a.url.localeCompare(b.url))
}
