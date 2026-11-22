/* Atom 1.0 output family: /[language/]blogs/atom.xml. */
import type { site_model } from "../../load/model.ts"
import { blog_entries, feed_path, xml_text as x } from "../../seo/rss.ts"

export function atom_xml(model: site_model, lang: string): string {
    const entries = blog_entries(model, lang), url = new URL(feed_path(model, lang, "atom"), model.config.base_url).href
    return `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom" xml:lang="${x(lang)}"><id>${x(url)}</id><title>${x(model.config.site_name)} Blogs</title><updated>${(entries[0]?.date ?? model.build_date).toISOString()}</updated><author><name>${x(model.config.owner.name)}</name></author><link href="${x(url)}" rel="self" type="application/atom+xml"/>${entries.map(entry => `<entry><id>${x(entry.url)}</id><title>${x(entry.title)}</title><link href="${x(entry.url)}"/><updated>${entry.date.toISOString()}</updated><summary>${x(entry.summary)}</summary></entry>`).join("")}</feed>`
}
