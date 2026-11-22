/* Bundle the independent desktop and shared host without importing personal-server modules. */
import { build } from "esbuild"
import { copyFileSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
const root = dirname(fileURLToPath(import.meta.url))
mkdirSync(join(root, "dist"), { recursive: true })
for (const [entry, name] of [["main.ts", "main"], ["host/preload.ts", "preload"], ["../shared/host/main.ts", "host"]]) {
    await build({ entryPoints: [join(root, entry)], outfile: join(root, `dist/${name}.cjs`), bundle: true, platform: "node", format: "cjs", target: "node22", external: ["electron"], logLevel: "error" })
}
copyFileSync(join(root, "../shared/host/pty_shim.py"), join(root, "dist/pty_shim.py"))
