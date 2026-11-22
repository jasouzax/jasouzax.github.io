/* Produce a load-unpacked extension, retaining its fixed ID and native host sources. */
import { cpSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

export function ext_command(root: string): string {
    const source = join(root, "extension"), out = join(root, ".cache", "extension")
    const manifest = JSON.parse(readFileSync(join(source, "manifest.json"), "utf8"))
    if (manifest.manifest_version !== 3 || !manifest.key) throw new Error("Extension requires a keyed Manifest V3 manifest")
    mkdirSync(out, { recursive: true })
    for (const name of ["manifest.json", "background.js", "content.js", "allowed_origins.json", "host"]) cpSync(join(source, name), join(out, name), { recursive: true })
    console.log(`Extension ready for Load unpacked: ${out}. Native host installation: node ${join(out, "host", "install.ts")}`)
    return out
}
