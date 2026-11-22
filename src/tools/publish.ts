/* Existing CLI publish behavior, owned by its step. */
import { resolve } from "node:path"
import { load_config } from "../../shared/config.ts"
import { output_directory } from "../../shared/paths.ts"
import { deploy, load_env } from "../step/cloud_deploy.ts"
import { publish_pages } from "../step/cloud_publish.ts"
import { show, run_build } from "../step/make.ts"
import type { flags } from "../config.ts"

export async function publish_command(root: string, flags: flags): Promise<void> {
    // CD: build, compare with the last successful deploy, upload with wrangler only when something differs.
    load_env(root)
    const result = flags.skip_build ? undefined : await run_build(root, flags, false)
    if (result) show(result)
    const config = result?.model.config ?? await load_config(root)
    const outcome = publish_pages(root, output_directory(root, String(flags.out ?? "dist")), String(flags.pages_project ?? config.deploy.pages_project), {
        overlay_dir: flags.overlay ? resolve(String(flags.overlay)) : undefined, state_file: flags.state_file ? resolve(String(flags.state_file)) : undefined,
        dry_run: Boolean(flags.dry_run), force: Boolean(flags.force), commit: flags.commit ? String(flags.commit) : undefined, message: flags.message ? String(flags.message) : undefined,
        branch: flags.branch ? String(flags.branch) : undefined, assets_bucket: flags.assets_bucket ? String(flags.assets_bucket) : undefined,
    })
    if (outcome.large_assets.length) console.warn(`warning: ${outcome.large_assets.length} file(s) over 25 MiB are served from R2`)
    console.log(`JAZU_PUBLISH ${JSON.stringify(outcome)}`)
    return
}
