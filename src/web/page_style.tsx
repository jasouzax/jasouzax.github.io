import { readFileSync, existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import type { xml_node } from "../xml.ts"
import { child_nodes, where_of } from "../xml.ts"
import type { page, site_model } from "../model.ts"
import type { output_files } from "../theme_css.ts"
import { report_error } from "../diag.ts"
import { select_print } from "../prints.ts"
import { short_hash, snake } from "../util.ts"

// A page-specific stylesheet: <style src="x.css" media="print"/> as a child of <page>. The file is copied as written (no scoping), so its
// selectors start with the page's body class (see body_class) to stay page-specific. Pages navigate without a reload (client_spa), so the
// page's JSON payload lists its styles and the client adds / removes the matching <link data-page-css> elements.
export type page_style = { href: string; media: string }

export function body_class(page: page): string {
    return page.path === "/" ? "page_portfolio" : `page_${snake(page.path.split("/")[1])}`
}

function style_source(node: xml_node): { css: string; missing: string | null } {
    if (!node.attrs.src) return { css: node.text, missing: null }
    const file = resolve(dirname(node.file), node.attrs.src)
    return existsSync(file)
        ? { css: readFileSync(file, "utf8"), missing: null }
        : { css: "", missing: node.attrs.src }
}

export function page_style_text(page: page): string {
    return child_nodes(page.node, "style")
        .map((node) => style_source(node).css)
        .join("\u0000")
}

export function emit_page_styles(model: site_model, files: output_files): Map<page, page_style[]> {
    const result = new Map<page, page_style[]>()
    for (const page of model.pages) {
        const styles: page_style[] = []
        for (const node of [
            ...child_nodes(page.node, "style"),
            ...(select_print(model, page)?.children.filter((node) => node.tag === "style") ?? [])
        ]) {
            const { css, missing } = style_source(node)
            if (missing) {
                report_error(model.diag, where_of(node), `page style not found: ${missing}`)
                continue
            }
            const base = node.attrs.src
                ? node.attrs.src
                      .split("/")
                      .pop()!
                      .replace(/\.css$/, "")
                : snake(page.path) || "page"
            const name = `assets/pages/${base}.${short_hash(css)}.css`
            files.set(name, css)
            const media = node.attrs.media && node.attrs.media !== "all" ? node.attrs.media : ""
            styles.push({ href: "/" + name, media })
        }
        if (styles.length > 0) result.set(page, styles)
    }
    return result
}
