/* Compile selected print styles and fonts through theme adapters, always guarded by print media. */
import type { site_model } from "../load/model.ts"
import type { xml_node } from "../../shared/content/xml.ts"
import { child_nodes } from "../../shared/content/xml.ts"
import { compile_scss, emit_font_to_map, rewrite_urls, type output_files } from "./theme.ts"
import { short_hash } from "../../shared/util.ts"
import type { page_style } from "./page.tsx"

export function compile_print(model: site_model, node: xml_node, files: output_files, data_scss = ""): page_style {
    const name = `print-${short_hash(JSON.stringify([node.attrs, node.file]))}`, parts: string[] = []
    for (const style of child_nodes(node, "style")) {
        const { css, base_dir } = compile_scss(model, node, style, data_scss)
        parts.push(rewrite_urls(css, base_dir, name, files, model))
    }
    for (const font of child_nodes(node, "font")) parts.push(emit_font_to_map(model, font, name, files, `/assets/themes/${name}`).css)
    const css = `@media print{${parts.join("\n")}}`
    const path = `assets/pages/${name}.${short_hash(css)}.css`
    files.set(path, css)
    return { href: `/${path}`, media: "print" }
}
