import { existsSync } from "node:fs"
import { join } from "node:path"
import type { site_model } from "./model.ts"
import { page_url, find_page } from "./model.ts"
import { report_error, report_warning } from "./diag.ts"
import { walk_nodes, where_of } from "./xml.ts"
import { normalize_path } from "./util.ts"
import { page_title, page_description, indexable } from "./web/seo_common.tsx"
import { has_icon } from "./web/seo_images.tsx"
import { security_txt } from "./web/seo_files.tsx"

export type tier_feature = { name: string, pattern: RegExp, tier: number, chrome: number, firefox: number, safari: number, fallback: string }

export const tier_features: tier_feature[] = [
    { name: ":has()", pattern: /:has\(/, tier: 2, chrome: 105, firefox: 121, safari: 15.4, fallback: "tier 1: states that depend on :has() are lost, navigation stays real links" },
    { name: ":where()", pattern: /:where\(/, tier: 1, chrome: 88, firefox: 78, safari: 14, fallback: "tier 0: scoped theme rules do not apply, browser default styling" },
    { name: "scroll-driven animation", pattern: /animation-timeline/, tier: 2, chrome: 115, firefox: 999, safari: 999, fallback: "slider arrows always visible" },
    { name: "@property", pattern: /@property/, tier: 2, chrome: 85, firefox: 128, safari: 16.4, fallback: "no animated custom properties" },
    { name: "dvh units", pattern: /\d(dvh|svh|lvh)/, tier: 1, chrome: 108, firefox: 101, safari: 15.4, fallback: "falls back to the previous declaration" },
    { name: "color-mix()", pattern: /color-mix\(/, tier: 2, chrome: 111, firefox: 113, safari: 16.2, fallback: "declaration dropped" },
]

export function check_links(model: site_model): void {
    for (const page of model.pages) {
        walk_nodes(page.node, node => {
            for (const name of ["link", "href"]) {
                const target = node.attrs[name]
                if (!target || !target.startsWith("/") || target.startsWith("//")) continue
                if (target.startsWith("/media/") || target.startsWith("/assets/") || target.startsWith("/api/")) continue
                const path = normalize_path(target.split("#")[0])
                if (path === "/work" || find_page(model, path, page.lang) || find_page(model, path, model.config.default_language)) continue
                report_warning(model.diag, where_of(node), `link ${target} does not match any page`)
            }
        })
    }
}

export function check_media(model: site_model): void {
    for (const page of model.pages) {
        for (const name of ["media", "poster", "image"]) {
            const value = page.node.attrs[name]
            if (!value || !value.startsWith("/media/")) continue
            if (!existsSync(join(model.content_dir, value.slice(1)))) report_warning(model.diag, where_of(page.node), `media file ${value} is not in content/media`)
        }
        // the photo printed on a rirekisho
        for (const resume of page.node.children.filter(child => child.tag === "resume")) {
            const photo = resume.attrs.photo
            if (photo?.startsWith("/media/") && !existsSync(join(model.content_dir, photo.slice(1)))) report_warning(model.diag, where_of(resume), `resume photo ${photo} is not in content/media (the form prints its "put a photo here" box instead)`)
        }
    }
}

export function check_page_rules(model: site_model): void {
    for (const page of model.pages) {
        if (!page.info && page.file !== "<generated>") report_warning(model.diag, where_of(page.node), "missing info (used as meta description)")
        if (page.path !== "/" && !find_page(model, "/", page.lang)) report_error(model.diag, where_of(page.node), `language ${page.lang} has no root page`)
        if (page.node.children.filter(child => child.tag === "desk").length > 1) report_error(model.diag, where_of(page.node), "a page may hold only one <desk>")
        if (page_url(model, page).length > 120) report_warning(model.diag, where_of(page.node), "url is very long")
    }
}

export function tier_report(css: string): string[] {
    return tier_features.filter(feature => feature.pattern.test(css)).map(feature => `${feature.name}: chrome ${feature.chrome}, firefox ${feature.firefox}, safari ${feature.safari} (tier ${feature.tier}) -> ${feature.fallback}`)
}

// Technical SEO lint: things a crawler or a link preview would trip over. Warnings only; `check --strict` turns them into failures.
export function check_seo(model: site_model): void {
    const base = model.config.base_url
    if (!/^https:\/\/[^/\s]+$/.test(base)) report_warning(model.diag, "config.json", `base_url "${base}" should be the site's https origin with no path (canonical, sitemap, manifest and Open Graph URLs are built from it)`)
    if (!has_icon(model)) report_warning(model.diag, "content", "no content/icon.svg (or content/media/signature.svg): favicon, touch icon and manifest icons are not generated")
    if (security_txt(model) === null) report_warning(model.diag, "config.json", "no security contact (seo.security.contact or owner.email): security.txt is not generated")
    const titles = new Map<string, string>()
    const infos = new Map<string, string>()
    for (const page of model.pages) {
        const where = where_of(page.node)
        const attrs = page.node.attrs
        if (attrs.lastmod && !/^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:\d{2}))?$/.test(attrs.lastmod)) report_warning(model.diag, where, `lastmod "${attrs.lastmod}" must be YYYY-MM-DD or an ISO 8601 date-time`)
        if (attrs.cover && /\.(svg|avif)(\?|$)/i.test(attrs.cover)) report_warning(model.diag, where, `cover ${attrs.cover}: most link-preview scrapers cannot read SVG or AVIF, use PNG or JPEG`)
        if (attrs.cover?.startsWith("/") && !existsSync(join(model.content_dir, attrs.cover.slice(1)))) report_warning(model.diag, where, `cover ${attrs.cover} does not exist under content/`)
        if (attrs.canonical && /^https?:\/\//.test(attrs.canonical) && !attrs.canonical.startsWith(base)) report_warning(model.diag, where, `canonical points to another site (${attrs.canonical}); this page is left out of the sitemap`)
        if (!indexable(model, page)) continue
        const title = page_title(model, page)
        const info = page_description(model, page)
        if (title.length > 60) report_warning(model.diag, where, `title is ${title.length} characters; search results cut it near 60`)
        if (info.length > 160) report_warning(model.diag, where, `description is ${info.length} characters; search results cut it near 160`)
        if (info.length > 0 && info.length < 50) report_warning(model.diag, where, `description is only ${info.length} characters; aim for 70 to 160`)
        const key = `${page.lang}:${title}`
        if (titles.has(key)) report_warning(model.diag, where, `same title as ${titles.get(key)}`)
        else titles.set(key, where)
        const info_key = `${page.lang}:${info}`
        if (info && infos.has(info_key)) report_warning(model.diag, where, `same description as ${infos.get(info_key)}`)
        else if (info) infos.set(info_key, where)
    }
}
