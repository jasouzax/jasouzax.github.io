import { redirects_file } from "../routes/_redirects.tsx"
import { headers_file } from "../routes/_headers.tsx"
import { sitemap_xml } from "../routes/sitemap.xml.tsx"
import { robots_txt } from "../routes/robots.txt.tsx"
import { jsx, fragment, raw_text, type child } from "../../shared/vnode/vnode.tsx"
import type { page, site_model } from "../load/model.ts"
import { page_url, in_menu, crumb_chain } from "../load/model.ts"
import { sha256, split_list, unique } from "../../shared/util.ts"
import { page_title, page_description, canonical_url, indexable, page_lastmod, text_direction } from "./model.tsx"
import { cover_of, has_icon } from "./cover.tsx"

export { page_title, page_description, canonical_url, indexable, page_lastmod }

// ---------- structured data ----------

function entity_id(model: site_model, name: string): string {
    return `${model.config.base_url}/#${name}`
}

function owner_node(model: site_model): object | null {
    const owner = model.config.owner
    if (!owner.name) return null
    const node: Record<string, unknown> = {
        "@type": model.config.seo.entity,
        "@id": entity_id(model, "owner"),
        name: owner.name,
        url: model.config.base_url + "/"
    }
    if (owner.email) node.email = owner.email
    if (owner.location) node.address = { "@type": "PostalAddress", addressLocality: owner.location }
    if (owner.github) node.sameAs = [`https://github.com/${owner.github}`]
    if (has_icon(model)) node.image = `${model.config.base_url}/icons/icon-512.png`
    return node
}

function breadcrumb_node(model: site_model, page: page): object | null {
    const chain = crumb_chain(model, page)
    if (chain.length < 2) return null
    return {
        "@type": "BreadcrumbList",
        "@id": `${canonical_url(model, page)}#breadcrumb`,
        itemListElement: chain.map((item, index) => ({
            "@type": "ListItem",
            position: index + 1,
            name: item.name,
            item: model.config.base_url + page_url(model, item)
        }))
    }
}

function page_type(page: page): string {
    if (page.path.startsWith("/desk/")) return "SoftwareApplication"
    if (page.path.startsWith("/blogs/")) return "BlogPosting"
    if (page.path === "/blogs") return "Blog"
    if (page.path === "/") return "ProfilePage"
    return "WebPage"
}

export function json_ld(model: site_model, page: page, theme_colors: [string, string]): object {
    const url = canonical_url(model, page)
    const owner = owner_node(model)
    const type = page_type(page) === "ProfilePage" && !owner ? "WebPage" : page_type(page)
    const cover = cover_of(model, page, theme_colors)
    const modified = page_lastmod(model, page)
    const main: Record<string, unknown> = {
        "@type": type,
        "@id": `${url}#page`,
        url,
        name: page.name,
        description: page_description(model, page),
        inLanguage: page.lang,
        isPartOf: { "@id": entity_id(model, "website") },
        image: {
            "@type": "ImageObject",
            url: cover.url,
            width: cover.width ?? undefined,
            height: cover.height ?? undefined
        }
    }
    if (modified) main.dateModified = modified
    if (type === "BlogPosting") {
        main.headline = page.name
        main.mainEntityOfPage = url
        if (owner) {
            main.author = { "@id": entity_id(model, "owner") }
            main.publisher = { "@id": entity_id(model, "owner") }
        }
    } else if (type === "SoftwareApplication") {
        main.applicationCategory = "UtilitiesApplication"
        main.operatingSystem = "Any"
        main.offers = { "@type": "Offer", price: "0", priceCurrency: "USD" }
    } else if (type === "ProfilePage") {
        if (owner) main.mainEntity = { "@id": entity_id(model, "owner") }
    } else if (owner) main.author = { "@id": entity_id(model, "owner") }
    const website: Record<string, unknown> = {
        "@type": "WebSite",
        "@id": entity_id(model, "website"),
        name: model.config.site_name,
        url: model.config.base_url + "/",
        inLanguage: Object.keys(model.config.languages)
    }
    if (owner) website.publisher = { "@id": entity_id(model, "owner") }
    const graph = [main, website, breadcrumb_node(model, page), owner].filter(Boolean)
    return { "@context": "https://schema.org", "@graph": graph }
}

// ---------- <head> ----------

function meta(
    kind: "name" | "property",
    name: string,
    content: string | number | undefined,
    managed: boolean
): child {
    if (content === undefined || content === "") return null
    return <meta {...{ [kind]: name }} content={content} data-seo={managed ? "" : undefined} />
}

export function page_keywords(model: site_model, page: page): string[] {
    const own = split_list(page.node.attrs.keywords)
    const tags = split_list(page.node.attrs.tags)
    return unique([...own, ...tags, ...model.config.seo.keywords]).slice(0, 12)
}

export function page_robots(model: site_model, page: page): string {
    if (page.node.attrs.robots) return page.node.attrs.robots
    return page.noindex ? "noindex, follow" : model.config.seo.robots.default
}

function locale_of(model: site_model, lang: string): string {
    const known = model.config.seo.locales[lang]
    if (known) return known
    const parts = lang.split("-")
    return parts.length === 2 ? `${parts[0]}_${parts[1].toUpperCase()}` : ""
}

export function theme_color_values(
    model: site_model,
    theme_colors: [string, string]
): { light: string; dark: string; single: string } {
    const given = model.config.seo.theme_color
    return { light: theme_colors[0], dark: theme_colors[1], single: given }
}

// Tags that depend on the page carry data-seo: the SPA payload sends the new set and the client swaps exactly those.
export function managed_head(model: site_model, page: page, theme_colors: [string, string]): child {
    const url = canonical_url(model, page)
    const title = page_title(model, page)
    const description = page_description(model, page)
    const cover = cover_of(model, page, theme_colors)
    const variants = model.pages.filter((item) => item.path === page.path)
    const keywords = page_keywords(model, page)
    const owner = model.config.owner.name
    const modified = page_lastmod(model, page)
    const twitter = model.config.seo.twitter.replace(/^@?/, "@")
    const lines: child[] = [
        meta("name", "description", description, true),
        meta("name", "keywords", keywords.join(", "), true),
        meta("name", "author", owner, true),
        meta("name", "robots", page_robots(model, page), true),
        <>
            <link rel={"canonical"} href={url} data-seo={""} />
        </>
    ]
    if (variants.length > 1) {
        for (const item of variants)
            lines.push(
                <>
                    <link
                        rel={"alternate"}
                        hreflang={item.lang}
                        href={canonical_url(model, item)}
                        data-seo={""}
                    />
                </>
            )
        const fallback = variants.find((item) => item.lang === model.config.default_language) ?? variants[0]
        lines.push(
            <>
                <link
                    rel={"alternate"}
                    hreflang={"x-default"}
                    href={canonical_url(model, fallback)}
                    data-seo={""}
                />
            </>
        )
    }
    lines.push(
        meta("property", "og:site_name", model.config.site_name, true),
        meta("property", "og:title", title, true),
        meta("property", "og:description", description, true),
        meta("property", "og:url", url, true),
        meta("property", "og:type", page.path.startsWith("/blogs/") ? "article" : "website", true),
        meta("property", "og:locale", locale_of(model, page.lang), true),
        ...variants
            .filter((item) => item.lang !== page.lang)
            .map((item) => meta("property", "og:locale:alternate", locale_of(model, item.lang), true)),
        meta("property", "og:image", cover.url, true),
        meta("property", "og:image:secure_url", cover.url.startsWith("https://") ? cover.url : "", true),
        meta("property", "og:image:type", cover.type, true),
        meta("property", "og:image:width", cover.width ?? undefined, true),
        meta("property", "og:image:height", cover.height ?? undefined, true),
        meta("property", "og:image:alt", cover.alt, true),
        page.path.startsWith("/blogs/") && modified
            ? meta("property", "article:modified_time", modified, true)
            : "",
        meta("name", "twitter:card", "summary_large_image", true),
        meta("name", "twitter:title", title, true),
        meta("name", "twitter:description", description, true),
        meta("name", "twitter:image", cover.url, true),
        meta("name", "twitter:image:alt", cover.alt, true),
        twitter.length > 1 ? meta("name", "twitter:site", twitter, true) : "",
        twitter.length > 1 ? meta("name", "twitter:creator", twitter, true) : "",
        <>
            <script type={"application/ld+json"} data-seo={""}>
                {raw_text(JSON.stringify(json_ld(model, page, theme_colors)).replace(/</g, "\\u003c"))}
            </script>
        </>
    )
    return lines
}

// Everything that is the same on every page: browser chrome, mobile web-app mode, icons, manifest.
export function fixed_head(model: site_model, theme_colors: [string, string]): child {
    const seo = model.config.seo
    const short = seo.short_name || model.config.site_name
    const colors = theme_color_values(model, theme_colors)
    const icons = has_icon(model)
    const lines: child[] = [
        meta("name", "application-name", model.config.site_name, false),
        meta("name", "apple-mobile-web-app-title", short, false),
        meta("name", "mobile-web-app-capable", "yes", false),
        meta("name", "apple-mobile-web-app-capable", "yes", false),
        meta("name", "apple-mobile-web-app-status-bar-style", seo.status_bar, false),
        meta("name", "format-detection", "telephone=no", false),
        meta("name", "referrer", "strict-origin-when-cross-origin", false),
        meta("name", "color-scheme", "light dark", false),
        colors.single ? (
            meta("name", "theme-color", colors.single, false)
        ) : (
            <>
                <meta name={"theme-color"} media={"(prefers-color-scheme: light)"} content={colors.light} />
                <meta name={"theme-color"} media={"(prefers-color-scheme: dark)"} content={colors.dark} />
            </>
        ),
        meta("name", "msapplication-TileColor", colors.single || colors.dark, false),
        meta("name", "generator", "JAZU", false)
    ]
    if (icons) {
        lines.push(
            <>
                <link rel={"icon"} href={"/favicon.ico"} sizes={"48x48"} />
            </>,
            <>
                <link rel={"icon"} href={"/icon.svg"} type={"image/svg+xml"} sizes={"any"} />
            </>,
            <>
                <link rel={"apple-touch-icon"} href={"/apple-touch-icon.png"} sizes={"180x180"} />
            </>
        )
    }
    lines.push(
        <>
            <link rel={"manifest"} href={"/manifest.json"} />
        </>,
        <>
            <link rel={"sitemap"} type={"application/xml"} href={"/sitemap.xml"} />
        </>
    )
    return lines
}

export function html_attrs(page: page): string {
    return `lang="${page.lang}" dir="${text_direction(page.lang)}"`
}

export function inline_script_hash(script: string): string {
    return Buffer.from(sha256(script), "hex").toString("base64")
}

export function nav_index(model: site_model): object[] {
    return model.pages
        .filter(in_menu)
        .map((page) => ({
            path: page_url(model, page),
            name: page.name,
            info: page.info,
            rank: page.rank,
            lang: page.lang
        }))
}

export { robots_txt } from "../routes/robots.txt.tsx"

export { sitemap_xml } from "../routes/sitemap.xml.tsx"

export { headers_file } from "../routes/_headers.tsx"

export { redirects_file } from "../routes/_redirects.tsx"
