import type { site_model, page } from "../model.ts"
import { page_url, find_page, localize } from "../model.ts"
import { normalize_path } from "../util.ts"

// The title every surface shares: <title>, og:title, twitter:title, the SPA payload.
export function page_title(model: site_model, page: page): string {
    return `${page.name} | ${model.config.site_name}`
}

// A page without its own `info` falls back to the site description, then to the home page's, so no page ships without a meta description.
export function page_description(model: site_model, page: page): string {
    if (page.info) return page.info
    if (model.config.seo.description) return model.config.seo.description
    return (
        find_page(model, "/", page.lang)?.info ??
        find_page(model, "/", model.config.default_language)?.info ??
        ""
    )
}

export function site_summary(model: site_model): string {
    return (
        model.config.seo.llms.summary ||
        model.config.seo.description ||
        find_page(model, "/", model.config.default_language)?.info ||
        ""
    )
}

export function absolute_url(model: site_model, href: string): string {
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return href
    return model.config.base_url + (href.startsWith("/") ? href : `/${href}`)
}

// `canonical` may be a path or a full URL; otherwise the page is its own canonical.
export function canonical_url(model: site_model, page: page): string {
    const given = page.node.attrs.canonical
    if (given) return /^https?:\/\//.test(given) ? given : model.config.base_url + normalize_path(given)
    return model.config.base_url + page_url(model, page)
}

// What belongs in sitemap.xml and llms.txt: crawlable, and not a duplicate pointing elsewhere.
export function indexable(model: site_model, page: page): boolean {
    if (page.noindex) return false
    const robots = page.node.attrs.robots ?? ""
    if (/\bnoindex\b/i.test(robots)) return false
    return canonical_url(model, page) === model.config.base_url + page_url(model, page)
}

export function page_lastmod(model: site_model, page: page): string {
    const mode = model.config.seo.lastmod
    const given = page.node.attrs.lastmod
    if (given && /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:\d{2}))?$/.test(given)) return given
    if (mode === "build") return model.build_date.toISOString().slice(0, 10)
    return ""
}

export function link_target(model: site_model, lang: string, href: string): string {
    return absolute_url(model, localize(model, lang, href))
}

export function text_direction(lang: string): "rtl" | "ltr" {
    return /^(ar|he|fa|ur|ps|sd|yi|dv|ug)(-|$)/i.test(lang) ? "rtl" : "ltr"
}
