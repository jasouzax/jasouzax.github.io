/* Existing CLI deploy behavior, owned by its step. */
import { output_directory } from "../../shared/paths.ts"
import { deploy } from "./cloud_deploy.ts"
import { show, run_build } from "./make.ts"
import type { flags } from "../config.ts"

export async function cloud_command(root: string, flags: flags): Promise<void> {
    const result = await run_build(root, flags, false)
    show(result)
    await deploy(root, output_directory(root, String(flags.out ?? "dist")), result, String(flags.target ?? "all"), Boolean(flags.dry_run))
    return
}
