/* RSS 2.0 output family: /[language/]blogs/rss.xml. */
import type { site_model } from "../../load/model.ts"
import { blog_entries, feed_path, xml_text as x } from "../../seo/rss.ts"

export function rss_xml(model: site_model, lang: string): string {
    const url = new URL(feed_path(model, lang, "rss"), model.config.base_url).href
    return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>${x(model.config.site_name)} Blogs</title><link>${x(new URL(feed_path(model, lang, "rss").replace(/\/rss.xml$/, "/"), model.config.base_url).href)}</link><description>${x(model.config.site_name)} blog updates</description><language>${x(lang)}</language><atom:link href="${x(url)}" rel="self" type="application/rss+xml"/>${blog_entries(model, lang).map(entry => `<item><title>${x(entry.title)}</title><link>${x(entry.url)}</link><guid isPermaLink="true">${x(entry.url)}</guid><description>${x(entry.summary)}</description><pubDate>${entry.date.toUTCString()}</pubDate></item>`).join("")}</channel></rss>`
}
