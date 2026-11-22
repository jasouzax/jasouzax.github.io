/* Existing CLI deploy behavior, owned by its step. */
import { output_directory } from "../../shared/paths.ts"
import { deploy } from "./cloud_deploy.ts"
import { show, run_build } from "./make.ts"
import type { flags } from "../config.ts"
import { cloud_preflight } from "./cloud_preflight.ts"
import { load_env } from "./cloud_deploy.ts"
import { load_config } from "../../shared/config.ts"

export async function cloud_command(root: string, flags: flags): Promise<void> {
    if (!flags.dry_run) {
        load_env(root)
        await cloud_preflight(root, await load_config(root))
        if (flags.preflight) return
    }
    const result = await run_build(root, flags, false)
    show(result)
    await deploy(root, output_directory(root, String(flags.out ?? "dist")), result, String(flags.target ?? "all"), Boolean(flags.dry_run))
    return
}
