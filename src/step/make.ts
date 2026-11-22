/* CLI responsibilities for step/make. */
import { build_site } from "../../engine/build/build.ts"
import { output_directory } from "../../shared/paths.ts"
import type { flags } from "../config.ts"

export function show(result: Awaited<ReturnType<typeof build_site>>): void {
    for (const warning of result.diag.warnings) console.warn(`warning: ${warning}`)
}

export async function run_build(root: string, flags: flags, only_check: boolean): ReturnType<typeof build_site> {
    return build_site({
        root, out: output_directory(root, String(flags.out ?? "dist")), mode: flags.dev ? "development" : "production", force: Boolean(flags.force),
        build_date: flags.date ? new Date(String(flags.date)) : new Date(), only_check, base_url: flags.base_url ? String(flags.base_url) : undefined,
    })
}

export async function make_command(root: string, flags: flags): Promise<void> {
    const result = await run_build(root, flags, false)
    show(result)
    console.log(`built ${result.pages} pages, wrote ${result.written.length} files, skipped ${result.skipped} unchanged pages`)
    return
}
