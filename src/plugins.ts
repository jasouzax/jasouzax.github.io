import { existsSync, readFileSync, realpathSync, statSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { build } from "esbuild"
import type { site_model } from "./model.ts"
import type { output_files } from "./theme_css.ts"
import type { plugin_info, plugin_case } from "./plugin_types.ts"
import { inside } from "./paths.ts"
import { report_error } from "./diag.ts"
import { where_of } from "./xml.ts"
import { sha256 } from "./util.ts"

export async function compile_plugins(model: site_model, files: output_files): Promise<plugin_info[]> {
    const manifest: plugin_info[] = []
    const seen = new Set<string>()
    for (const node of model.plugins) {
        if (seen.has(node.attrs.id)) {
            report_error(model.diag, where_of(node), `duplicate plugin ${node.attrs.id}`)
            continue
        }
        seen.add(node.attrs.id)
        const info: plugin_info = { ...node.attrs, id: node.attrs.id, version: node.attrs.version }
        if (node.children.length) info.cases = node.children.filter(child => child.tag === "case").map(child => ({ ...child.attrs }) as plugin_case)
        const publish = async (kind: "script" | "wasm", reference: string): Promise<string> => {
            const source = resolve(reference.startsWith("/") ? model.content_dir : dirname(node.file), reference.replace(/^\//, ""))
            if (!inside(model.content_dir, source) || !existsSync(source) || !statSync(source).isFile() || !inside(realpathSync(model.content_dir), realpathSync(source))) {
                report_error(model.diag, where_of(node), `plugin ${kind} must be a file inside content: ${reference}`)
                return reference
            }
            let bytes: Uint8Array = readFileSync(source)
            if (kind === "script") {
                const result = await build({ entryPoints: [source], bundle: true, write: false, format: "esm", platform: "browser", target: "es2020", minify: model.mode === "production", logLevel: "silent" })
                bytes = result.outputFiles[0].contents
            } else if (sha256(bytes) !== info.sha256?.toLowerCase()) {
                report_error(model.diag, where_of(node), `plugin WASM integrity mismatch: ${reference}`)
            }
            const name = `assets/plugins/${sha256(bytes).slice(0, 16)}.${kind === "script" ? "js" : "wasm"}`
            files.set(name, Buffer.from(bytes))
            return "/" + name
        }
        if (info.script) info.script = await publish("script", info.script)
        if (info.wasm) info.wasm = await publish("wasm", info.wasm)
        for (const entry of info.cases ?? []) if (entry.script) entry.script = await publish("script", entry.script)
        manifest.push(info)
    }
    files.set("assets/plugins.json", JSON.stringify(manifest))
    return manifest
}
