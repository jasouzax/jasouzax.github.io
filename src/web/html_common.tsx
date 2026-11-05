import { jsx, fragment, type child } from "./vnode.tsx"
import { raw } from "./markup.tsx"
import type { page, site_model } from "../model.ts"
import { icon_of, ui_text, localize } from "../model.ts"
import { esc_html, esc_attr } from "../util.ts"
import type { html } from "../util.ts"
import type { expertise_model } from "../expertise.ts"

export type render_ctx = {
    model: site_model
    page: page
    lang: string
    expertise: expertise_model | null
}

export function t(ctx: render_ctx, key: string): string {
    return ui_text(ctx.model, ctx.lang, key)
}

export function icon(ctx: render_ctx, value: string | undefined, where: string = ctx.page.file): string {
    return icon_of(ctx.model, value, where)
}

export function glyph(ctx: render_ctx, value: string | undefined, class_name?: string): html {
    const chars = icon(ctx, value)
    return chars ? (
        <span class={class_name} aria-hidden="true">
            {chars}
        </span>
    ) : null
}

export function text_of(ctx: render_ctx, value: string | undefined): string {
    return icon(ctx, value)
}

export function link_attrs(ctx: render_ctx, href: string): import("./vnode.tsx").attributes {
    const external = /^https?:\/\//.test(href)
    return {
        href: localize(ctx.model, ctx.lang, href),
        ...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})
    }
}
