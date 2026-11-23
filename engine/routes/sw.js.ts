import { build } from "esbuild"
import { join } from "node:path"
import { sha256 } from "../../shared/util.ts"
import type { output_files } from "../style/theme.ts"
import type { site_config } from "../../shared/config.ts"
import { online_route } from "../../shared/offline.ts"
import { offline_html } from "./offline.html.tsx"

export async function pwa_files(root: string, files: output_files, skipped: Map<string, string | Uint8Array>, config: site_config, expertise_media: Set<string>): Promise<void> {
    if (!config.pwa.enabled) return
    files.set("offline.html", offline_html())
    const online_prefixes = ["", ...Object.keys(config.languages).map(lang => `/${lang}`)].flatMap(lang => ["desk", "server", "work"].map(name => `${lang}/${name}`))
    const contents = new Map([...skipped, ...files])
    const entries = [...contents].filter(([name]) => {
        const path = `/${name}`
        return !name.startsWith("_") && !name.startsWith(".") && !["service-worker.js", "offline.json"].includes(name) && !/^(api\/|.*\.git\/)/.test(name) && !online_route(path, online_prefixes) &&
            !config.pwa.exclude_prefixes.some(prefix => path.startsWith(prefix)) &&
            !(config.pwa.exclude_expertise_media && expertise_media.has(path))
    }).map(([name, data]) => ({ url: `/${name}`, revision: sha256(data) })).sort((a, b) => a.url.localeCompare(b.url))
    const version = sha256(JSON.stringify(entries))
    const settings = { version, entries, notifications: config.pwa.notifications, online_prefixes }
    const bundled = await build({ entryPoints: [join(root, "desk/site/service_worker.ts")], bundle: true, write: false, format: "iife", minify: true, define: { __PWA__: JSON.stringify(settings) }, logLevel: "silent" })
    files.set("service-worker.js", bundled.outputFiles[0].text)
    files.set("offline.json", JSON.stringify({ version, files: entries.map(entry => entry.url), bytes: [...contents].filter(([name]) => entries.some(entry => entry.url === `/${name}`)).reduce((sum, [, data]) => sum + (typeof data === "string" ? Buffer.byteLength(data) : data.byteLength), 0) }))
}
