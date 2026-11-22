/* Existing CLI check behavior, owned by its step. */
import { check_links, check_media, check_page_rules, check_seo } from "../../engine/check/check.ts"
import { show, run_build } from "./make.ts"
import { print_report } from "./report.ts"
import type { flags } from "../config.ts"

export async function check_command(root: string, flags: flags): Promise<void> {
    const result = await run_build(root, flags, true)
    check_links(result.model)
    check_media(result.model)
    check_page_rules(result.model)
    check_seo(result.model)
    show(result)
    for (const error of result.diag.errors) console.error(`error: ${error}`)
    if (flags.report) await print_report(root, flags)
    if (result.diag.errors.length > 0 || (flags.strict && result.diag.warnings.length > 0)) process.exitCode = 1
    else console.log(`ok: ${result.pages} pages, ${result.diag.warnings.length} warnings`)
    return
}
