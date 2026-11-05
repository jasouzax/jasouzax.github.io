import type { site_model } from "../model.ts"
import { menu_pages, find_page, page_url } from "../model.ts"
import { page_description, site_summary, text_direction, indexable } from "./seo_common.tsx"
import { has_icon } from "./seo_images.tsx"
import type { brand } from "./seo_images.tsx"

// A web app manifest: with the icons it makes the site installable ("Add to Home Screen") and sets the browser UI colours when it is launched that way.
export function manifest_json(model: site_model, theme_colors: [string, string], colors: brand): string {
    const seo = model.config.seo
    const lang = model.config.default_language
    const home = find_page(model, "/", lang)
    const icons = has_icon(model)
        ? [
              { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
              { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
              {
                  src: "/icons/icon-maskable-512.png",
                  sizes: "512x512",
                  type: "image/png",
                  purpose: "maskable"
              },
              { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }
          ]
        : []
    const shortcuts = menu_pages(model, "/", lang)
        .filter((page) => page.path !== "/" && indexable(model, page))
        .slice(0, seo.manifest.shortcuts)
        .map((page) => ({
            name: page.name,
            url: page_url(model, page),
            description: page_description(model, page)
        }))
    const manifest: Record<string, unknown> = {
        id: "/",
        name: model.config.site_name,
        short_name: seo.short_name || model.config.site_name,
        description: site_summary(model) || (home ? page_description(model, home) : ""),
        lang,
        dir: text_direction(lang),
        start_url: "/",
        scope: "/",
        display: seo.manifest.display,
        orientation: seo.manifest.orientation,
        theme_color: seo.theme_color || theme_colors[0],
        background_color: seo.background_color || colors.background,
        categories: seo.manifest.categories.length ? seo.manifest.categories : undefined,
        icons,
        shortcuts: shortcuts.length ? shortcuts : undefined
    }
    return JSON.stringify(manifest, null, 4) + "\n"
}

function with_scheme(contact: string): string {
    if (/^[a-z][a-z0-9+.-]*:/i.test(contact)) return contact
    return contact.includes("@") ? `mailto:${contact}` : contact
}

// RFC 9116. Expires is the end of a month a few months ahead, so the file only changes once a month and stays reproducible with --date.
// Returns null when no contact is known: a security.txt without Contact is invalid, so none is better than a broken one.
export function security_txt(model: site_model): string | null {
    const given = model.config.seo.security
    const contacts = (
        given.contact.length ? given.contact : model.config.owner.email ? [model.config.owner.email] : []
    ).map(with_scheme)
    if (contacts.length === 0) return null
    const date = model.build_date
    const end = new Date(
        Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + given.expires_months + 1, 0, 23, 59, 59)
    )
    const lines = [
        `# Security contact for ${new URL(model.config.base_url).host}`,
        ...contacts.map((contact) => `Contact: ${contact}`),
        `Expires: ${end.toISOString().replace(/\.\d{3}Z$/, "Z")}`,
        `Preferred-Languages: ${Object.keys(model.config.languages).join(", ")}`,
        `Canonical: ${model.config.base_url}/.well-known/security.txt`,
        given.policy ? `Policy: ${given.policy}` : "",
        given.encryption ? `Encryption: ${given.encryption}` : "",
        given.acknowledgments ? `Acknowledgments: ${given.acknowledgments}` : "",
        given.hiring ? `Hiring: ${given.hiring}` : ""
    ]
    return lines.filter(Boolean).join("\n") + "\n"
}
