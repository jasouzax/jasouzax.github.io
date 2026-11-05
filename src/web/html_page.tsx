import { jsx, fragment, raw_text, serialize, to_html, type child } from "./vnode.tsx"
import { raw } from "./markup.tsx"
import type { render_ctx } from "./html_common.tsx"
import { t } from "./html_common.tsx"
import type { page, site_model } from "../model.ts"
import { page_url, has_section, localize, ui_text } from "../model.ts"
import { build_expertise } from "../expertise.ts"
import { render_expertise } from "./html_expertise.tsx"
import { render_hero } from "./html_sections.tsx"
import { render_desk, window_infos } from "./html_desk.tsx"
import { render_head, type tab } from "./html_head.tsx"
import { fixed_head, managed_head, page_title, canonical_url } from "./seo.tsx"
import { text_direction } from "./seo_common.tsx"
import { body_class, type page_style } from "./page_style.tsx"
import { background_default } from "./partials/background_default.tsx"
import { background_memory } from "./partials/background_memory.tsx"

export type theme_assets = {
    name: string
    css: string
    js: string | null
    fonts: string[]
    colors: [string, string]
    background: string
    label: string
}
export type page_assets = {
    themes: Record<string, theme_assets>
    runtime_page: string
    runtime_theme_switch: string
    runtime_desk_shell: string
    boot_script: string
    nav_index: string
    page_styles: Map<page, page_style[]>
}
export type rendered_page = { url: string; html: string; json: object }

function slots(model: site_model, group: string): child {
    return Array.from({ length: model.config.slots[group] ?? 0 }, (_, index) => (
        <div class={`${group} ${group}_${String(index).padStart(model.config.slot_digits, "0")}`} />
    ))
}
export function background_html(model: site_model, theme: theme_assets): child {
    const decorations = slots(model, "background_entity")
    return (
        <div id="theme_background">
            {theme.background === "default"
                ? background_default(decorations)
                : background_memory(decorations)}
            <div class="foreground" aria-hidden="true">
                {slots(model, "foreground_entity")}
            </div>
        </div>
    )
}
function section_tabs(ctx: render_ctx): tab[] {
    let hero_index = 0
    return ctx.page.node.children.flatMap((node) => {
        if (node.tag === "hero") {
            const index = hero_index++,
                id = index === 0 ? "home" : index === 1 ? "contact" : `hero_${index}`
            return [
                {
                    href: `#${id}`,
                    icon: index === 0 ? "[home]" : "[contact]",
                    label: node.attrs.tab ?? node.attrs.name ?? ui_text(ctx.model, ctx.lang, id)
                }
            ]
        }
        return node.tag === "expertise"
            ? [{ href: "#expertise", icon: "[expertise]", label: t(ctx, "expertise") }]
            : []
    })
}
function main_content(ctx: render_ctx): { body: child; tabs: tab[]; has_desk: boolean } {
    const tabs = section_tabs(ctx),
        parts: child[] = []
    let has_desk = false
    for (const node of ctx.page.node.children) {
        if (node.tag === "hero") parts.push(render_hero(ctx, node, node === ctx.page.node.children.find(child => child.tag === "hero") ? tabs[1]?.href.slice(1) ?? "" : ""))
        if (node.tag === "expertise" && ctx.expertise) parts.push(render_expertise(ctx, node, ctx.expertise))
        if (node.tag === "desk") {
            has_desk = true
            parts.push(render_desk(ctx, node))
            for (const info of window_infos(ctx, node))
                tabs.push({ href: `#window-${info.index}`, icon: info.icon, label: info.label })
        }
    }
    return { body: parts, tabs, has_desk }
}
function footer(ctx: render_ctx): child {
    return (
        <footer class="site_foot">
            <a href={localize(ctx.model, ctx.lang, "/privacy")}>{t(ctx, "privacy")}</a>{" "}
            <a href={localize(ctx.model, ctx.lang, "/sitemap")}>{t(ctx, "sitemap")}</a>
            <noscript>
                <p class="site_foot_note">{t(ctx, "cookie_note")}</p>
            </noscript>
        </footer>
    )
}
export function render_page(
    model: site_model,
    page: page,
    assets: page_assets,
    shared: { expertise: ReturnType<typeof build_expertise> }
): rendered_page {
    const ctx: render_ctx = { model, page, lang: page.lang, expertise: shared.expertise },
        theme = assets.themes[model.config.default_theme]
    const main = main_content(ctx),
        head = render_head(ctx, main.tabs, main.has_desk),
        url = page_url(model, page),
        title = page_title(model, page)
    const managed = managed_head(model, page, theme.colors),
        styles = assets.page_styles.get(page) ?? []
    const document = (
        <html
            lang={page.lang}
            dir={text_direction(page.lang)}
            data-theme={model.config.default_theme}
            data-mode="auto"
            data-loading={ui_text(model, page.lang, "loading")}
        >
            <head>
                <meta charset="utf-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
                <title>{title}</title>
                {fixed_head(model, theme.colors)}
                {managed}
                <script>{raw_text(assets.boot_script)}</script>
                {theme.fonts.map((href) => (
                    <link rel="preload" href={href} as="font" type="font/woff2" crossorigin="" />
                ))}
                <link
                    rel="stylesheet"
                    href={theme.css}
                    id="theme_css"
                    data-theme-css={model.config.default_theme}
                />
                {styles.map((style) => (
                    <link
                        rel="stylesheet"
                        href={style.href}
                        media={style.media || undefined}
                        data-page-css=""
                    />
                ))}
            {theme.js && <script src={theme.js} defer />}
            </head>
            <body class={body_class(page)}>
                {background_html(model, theme)}
                {head}
                <main id="main-content" tabindex="-1">
                    {main.body}
                </main>
                {footer(ctx)}
                <div
                    class="cookie_notice needs_js"
                    role="region"
                    aria-label={t(ctx, "cookie_label")}
                    hidden
                />
                <script
                    src={assets.runtime_page}
                    data-theme-switch={assets.runtime_theme_switch}
                    data-desk-shell={assets.runtime_desk_shell}
                    defer
                />
            </body>
        </html>
    )
    return {
        url,
        html: "<!doctype html>\n" + to_html(document),
        json: {
            path: page.path,
            loading: ui_text(model, page.lang, "loading"),
            title,
            name: page.name,
            info: page.info,
            canonical: canonical_url(model, page),
            lang: page.lang,
            dir: text_direction(page.lang),
            body_class: body_class(page),
            has_desk: main.has_desk,
            head: serialize(managed),
            header: serialize(head),
            main: serialize(main.body),
            styles,
            tabs: main.tabs.map((item) => ({ href: item.href, label: item.label })),
            hreflang: model.pages
                .filter((item) => item.path === page.path)
                .map((item) => ({ lang: item.lang, path: page_url(model, item) }))
        }
    }
}
export function has_expertise_page(page: page): boolean {
    return has_section(page, "expertise")
}
