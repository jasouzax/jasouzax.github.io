import { jsx, fragment, type child } from "./vnode.tsx"
import { raw } from "./markup.tsx"
import { readFileSync } from "node:fs"
import { configured_resource } from "../resources.ts"
import type { render_ctx } from "./html_common.tsx"
import { t, glyph } from "./html_common.tsx"
import { crumb_chain, menu_pages, page_url, ui_text, localize, type page } from "../model.ts"
export type tab = { href: string; icon: string; label: string }
export type theme_choice = { name: string; label: string; icon: string }
export function theme_choices(ctx: render_ctx): theme_choice[] {
    const wanted = ctx.model.config.themes
    return ctx.model.themes
        .filter((node) => node.attrs.name && (wanted === "all" || wanted.includes(node.attrs.name)))
        .map((node) => ({
            name: node.attrs.name,
            label: node.attrs.label ?? node.attrs.name,
            icon: node.attrs.icon ?? "[star]"
        }))
}
function signature(ctx: render_ctx): child {
    const file = configured_resource(ctx.model, "signature")
    if (!file) return <span id="head_path_logo">{ctx.model.config.site_name}</span>
    return raw(readFileSync(file, "utf8").replace(/<svg\b/, '<svg id="head_path_logo"'))
}
function search_row(ctx: render_ctx, label: string): child {
    return (
        <li class="list_drop_search needs_js" role="search">
            <label>
                {glyph(ctx, "[search]")}
                <input
                    type="search"
                    placeholder={label}
                    aria-label={label}
                    autocomplete="off"
                    spellcheck="false"
                />
            </label>
        </li>
    )
}
function crumb_menu(ctx: render_ctx, container: page, id?: string): child {
    const all = menu_pages(ctx.model, container.path, ctx.lang),
        limit = ctx.model.config.dropdown_limit
    return (
        <details class="list crumb" id={id} name="droplist">
            <summary class="list_summ" title={t(ctx, "site_pages")} aria-label={t(ctx, "site_pages")}>
                {glyph(ctx, "[chevron_right]")}
            </summary>
            <ul class="list_drop">
                {all.length > limit && search_row(ctx, t(ctx, "filter_pages"))}
                {all.slice(0, limit).map((item) => (
                    <li class="list_drop_li">
                        <a
                            href={page_url(ctx.model, item)}
                            aria-current={item.path === ctx.page.path ? "page" : undefined}
                        >
                            {glyph(ctx, item.icon, "list_drop_icon")}
                            {item.name}
                        </a>
                    </li>
                ))}
                {all.length > limit && (
                    <li class="list_drop_li">
                        <a href={localize(ctx.model, ctx.lang, "/sitemap")}>{t(ctx, "all_pages")}</a>
                    </li>
                )}
                <li class="list_drop_empty" role="status" hidden>
                    {t(ctx, "no_pages")}
                </li>
            </ul>
        </details>
    )
}
function simple_menu(ctx: render_ctx, key: string, token: string, items: child, search?: string): child {
    return (
        <details id={`head_${key}`} class="list end" name="droplist">
            <summary class="list_summ" title={t(ctx, key)} aria-label={t(ctx, key)}>
                {glyph(ctx, token)}
            </summary>
            <ul class="list_drop">
                {search && search_row(ctx, t(ctx, search))}
                {items}
            </ul>
        </details>
    )
}
function language_menu(ctx: render_ctx): child {
    const order = Object.keys(ctx.model.config.languages)
    // A missing translation links to the default-language page rather than disappearing.
    const variants = ctx.model.pages.filter((page) => page.path === ctx.page.path)
    const items = order.map((lang) => {
        const target =
            variants.find((page) => page.lang === lang) ??
            variants.find((page) => page.lang === ctx.model.config.default_language)
        if (!target) return null
        const name = new Intl.DisplayNames([lang], { type: "language" }).of(lang) ?? lang
        return (
            <li class="list_drop_li">
                <a
                    href={page_url(ctx.model, target)}
                    hreflang={target.lang}
                    lang={lang}
                    aria-current={lang === ctx.lang ? "page" : undefined}
                >
                    {glyph(ctx, `[lang:${lang}]`, "list_drop_icon")}
                    {name.charAt(0).toLocaleUpperCase(lang) + name.slice(1)} ({lang})
                </a>
            </li>
        )
    })
    return simple_menu(ctx, "language", "[globe]", items)
}
function radio(
    ctx: render_ctx,
    id: string,
    name: string,
    value: string,
    label: string,
    token: string,
    checked: boolean,
    type = "radio",
    divider = false
): child {
    return (
        <li class={`list_drop_li${divider ? " list_drop_li_div" : ""}`}>
            <input
                id={id}
                class="theme_radio"
                type={type}
                name={type === "radio" ? name : undefined}
                value={type === "radio" ? value : undefined}
                checked={checked}
            />
            <label for={id}>
                {glyph(ctx, token, "list_drop_icon")}
                {label}
            </label>
        </li>
    )
}
function theme_menu(ctx: render_ctx): child {
    const modes = [
        ["auto", "theme_auto", "[auto]"],
        ["light", "theme_light", "[sun]"],
        ["dark", "theme_dark", "[moon]"]
    ]
    const items: child[] = modes.map(([value, key, token], index) =>
        radio(
            ctx,
            `theme_state_${value}`,
            "theme_state",
            value,
            ui_text(ctx.model, ctx.lang, key),
            token,
            index === 0,
            "radio",
            index === 2
        )
    )
    const sound = ctx.model.config.sfx.enabled_default
    items.push(
        radio(ctx, "theme_audio_mute", "theme_audio", "mute", t(ctx, "mute"), "[mute]", !sound),
        radio(
            ctx,
            "theme_audio_audio",
            "theme_audio",
            "audio",
            t(ctx, "audio"),
            "[audio]",
            sound,
            "radio",
            true
        ),
        radio(ctx, "motion_pause", "", "", t(ctx, "pause_motion"), "[pause]", false, "checkbox", true)
    )
    for (const choice of theme_choices(ctx))
        items.push(
            radio(
                ctx,
                `theme_name_${choice.name}`,
                "theme_name",
                choice.name,
                choice.label,
                choice.icon,
                choice.name === ctx.model.config.default_theme
            )
        )
    return simple_menu(ctx, "theme", "[theme]", items)
}
function window_actions(ctx: render_ctx): child {
    const controls = [
        ["head_new", "new_window", "[window_new]"],
        ["head_mini", "minimize", "[minimize]"],
        ["head_full", "maximize", "[fullscreen]"],
        ["head_exit", "close_window", "[close]"]
    ]
    return (
        <details id="head_window" class="list end" name="droplist">
            <summary class="list_summ" title={t(ctx, "window_options")} aria-label={t(ctx, "window_options")}>
                {glyph(ctx, "[window]")}
            </summary>
            <ul class="list_drop">
                {controls.map(([id, key, icon]) => (
                    <li class="list_drop_li">
                        <button id={id} title={t(ctx, key)}>
                            {glyph(ctx, icon, "list_drop_icon")}
                            <span class="list_drop_label">{t(ctx, key)}</span>
                        </button>
                    </li>
                ))}
            </ul>
        </details>
    )
}
export function render_head(ctx: render_ctx, tabs: tab[], has_desk: boolean): child {
    const chain = crumb_chain(ctx.model, ctx.page),
        root = chain.find((page) => page.path === "/") ?? ctx.page
    const crumbs = chain.filter((page) => page.path !== "/" || chain.length === 1)
    const project = ctx.model.objects.some(node => node.tag === "project" &&
        ctx.page.path === `/projects/${node.attrs.id}` && ctx.lang === node.attrs.lang)
    const account = (
        <>
        <li class="list_drop_li" data-auth="guest">
            <button
                type="button"
                data-sign="google"
            >
                {glyph(ctx, "[google]", "list_drop_icon")}
                <span class="sign_text">{t(ctx, "sign_google")}</span>
            </button>
        </li>
        <li class="list_drop_li" data-auth="user" hidden="true">
            <button type="button" data-sign="out" title={t(ctx, "sign_out_google_title")}>
                {glyph(ctx, "[google]", "list_drop_icon")}
                <span class="sign_text">{t(ctx, "sign_out_google")}</span>
            </button>
        </li>
        <li class="list_drop_li" data-auth="user" hidden="true">
            <button type="button" data-sign="delete" data-confirm={t(ctx, "delete_account_confirm")}>
                <span class="sign_text">{t(ctx, "delete_account")}</span>
            </button>
        </li>
        <li class="list_drop_li" data-auth="user" hidden="true">
            <button type="button" data-notifications="true" data-offline-label={t(ctx, "pwa_offline")} data-notification-title={t(ctx, "notification_title")} data-notification-dismiss={t(ctx, "notification_dismiss")} data-notification-enabled={t(ctx, "notification_enabled")} data-notification-denied={t(ctx, "notification_denied")} data-notification-retry={t(ctx, "notification_retry")}>{t(ctx, "notification_enable")}</button>
        </li>
        <li class="list_drop_separator" role="separator" />
        <li class="list_drop_li needs_js">
            <button type="button" data-connect-folder="" data-unsupported={t(ctx, "folder_connect_unsupported")}
                data-connect={t(ctx, "folder_connect")} data-disconnect={t(ctx, "folder_disconnect")} data-connecting={t(ctx, "folder_connecting")}
                data-session={t(ctx, "folder_connected_session")} data-failed={t(ctx, "folder_connect_failed")}>
                {glyph(ctx, "[folder]", "list_drop_icon")}
                <span data-folder-label="">{t(ctx, "folder_connect")}</span>
            </button>
        </li>
        <li class="list_drop_li needs_js" hidden="true"><button type="button" data-folder-authorize="" data-failed={t(ctx, "folder_connect_failed")}>{t(ctx, "folder_authorize")}</button></li>
        <li class="list_drop_status" data-folder-status="" role="status" aria-live="polite" hidden="true" />
        </>
    )
    return (
        <header id="head">
            <details id="head_menu" class="list" name="sidemenu" hidden={!has_desk} open={has_desk && project}>
                <summary class="list_summ" aria-label={t(ctx, "show_side")}>
                    {glyph(ctx, "[menu]")}
                </summary>
            </details>
            <a id="head_skip" href="#main-content">
                {t(ctx, "skip_main")}
            </a>
            <a id="head_signature" href={page_url(ctx.model, root)} aria-label={t(ctx, "home_label")}>
                {signature(ctx)}
            </a>
            {crumb_menu(ctx, root, "head_div")}
            <nav id="head_path" aria-label={t(ctx, "breadcrumbs")}>
                {crumbs.map((crumb, index) => (
                    <>
                        {index > 0 && crumb_menu(ctx, crumbs[index - 1])}
                        <a
                            href={page_url(ctx.model, crumb)}
                            aria-current={crumb.path === ctx.page.path ? "page" : undefined}
                        >
                            {crumb.name}
                        </a>
                    </>
                ))}
            </nav>
            <nav id="head_tabs" aria-label={t(ctx, "page_tabs")}>
                {tabs.map((item) => (
                    <a href={item.href}>
                        {glyph(ctx, item.icon)}
                        <span class="head_tab_name">{item.label}</span>
                    </a>
                ))}
            </nav>
            <div id="head_tray">
                {has_desk && window_actions(ctx)}
                {simple_menu(ctx, "account", "[account]", account)}
                {language_menu(ctx)}
                {theme_menu(ctx)}
            </div>
        </header>
    )
}
