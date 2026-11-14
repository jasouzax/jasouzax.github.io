/* Build a deterministic allowlist: public output only, never API responses or Git mirrors. */
import { build } from "esbuild"
import { join } from "node:path"
import { sha256 } from "./util.ts"
import type { output_files } from "./theme_css.ts"
import type { site_config } from "./config.ts"

export async function pwa_files(root: string, files: output_files, skipped: Map<string, string | Uint8Array>, config: site_config, expertise_media: Set<string>): Promise<void> {
    if (!config.pwa.enabled) return
    const contents = new Map([...skipped, ...files])
    const entries = [...contents].filter(([name]) => {
        const path = `/${name}`
        return !name.startsWith("_") && !name.startsWith(".") && !/^(api\/|.*\.git\/)/.test(name) &&
            !config.pwa.exclude_prefixes.some(prefix => path.startsWith(prefix)) &&
            !(config.pwa.exclude_expertise_media && expertise_media.has(path))
    }).map(([name, data]) => ({ url: `/${name}`, revision: sha256(data) })).sort((a, b) => a.url.localeCompare(b.url))
    const version = sha256(JSON.stringify(entries))
    const settings = { version, entries, notifications: config.pwa.notifications }
    const bundled = await build({ entryPoints: [join(root, "src/web/pwa_worker.ts")], bundle: true, write: false, format: "iife", minify: true, define: { __PWA__: JSON.stringify(settings) }, logLevel: "silent" })
    files.set("service-worker.js", bundled.outputFiles[0].text)
    files.set("offline.json", JSON.stringify({ version, files: entries.map(entry => entry.url), bytes: [...contents].filter(([name]) => entries.some(entry => entry.url === `/${name}`)).reduce((sum, [, data]) => sum + (typeof data === "string" ? Buffer.byteLength(data) : data.byteLength), 0) }))
}
