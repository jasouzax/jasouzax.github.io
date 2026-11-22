/* Generate indexable canonical page and language-alternate URLs. */
import { jsx, fragment } from "../../shared/vnode/vnode.tsx"
import type { page, site_model } from "../load/model.ts"
import { esc_attr } from "../../shared/util.ts"
import { canonical_url, indexable, page_lastmod } from "../seo/model.tsx"

export function sitemap_xml(model: site_model): string {
    const entries = model.pages
        .filter((page) => indexable(model, page))
        .map((page) => {
            const variants = model.pages.filter((item) => item.path === page.path && indexable(model, item))
            const links =
                variants.length > 1
                    ? [
                          ...variants.map((item) => ({ lang: item.lang, page: item })),
                          {
                              lang: "x-default",
                              page:
                                  variants.find((item) => item.lang === model.config.default_language) ??
                                  variants[0]
                          }
                      ]
                    : []
            const alternates = links.map(
                (link) =>
                    `<xhtml:link rel="alternate" hreflang="${esc_attr(link.lang)}" href="${esc_attr(canonical_url(model, link.page))}"/>`
            )
            const modified = page_lastmod(model, page)
            return `<url><loc>${esc_attr(canonical_url(model, page))}</loc>${modified ? `<lastmod>${modified}</lastmod>` : ""}${alternates.join("")}</url>`
        })
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${entries.join("\n")}\n</urlset>\n`
}
