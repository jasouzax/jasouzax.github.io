/* CLI responsibilities for step/report. */
import { resolve, join } from "node:path"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { tier_report } from "../../engine/check/check.ts"
import type { flags } from "../config.ts"

export async function print_report(root: string, flags: flags): Promise<void> {
    const out = resolve(root, String(flags.out ?? "dist"))
    const themes = join(out, "assets", "themes")
    if (!existsSync(themes)) return console.log("report: run build first")
    const { readdirSync } = await import("node:fs")
    for (const name of readdirSync(join(themes, "default"))) {
        if (!name.endsWith(".css")) continue
        console.log(`browser tiers for default theme css:`)
        for (const line of tier_report(readFileSync(join(themes, "default", name), "utf8"))) console.log(`  ${line}`)
    }
}
