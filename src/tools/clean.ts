/* Existing CLI clean behavior, owned by its step. */
import { join } from "node:path"
import { rmSync, existsSync } from "node:fs"
import { output_directory, inside } from "../../shared/paths.ts"
import { realpathSync } from "node:fs"
import type { flags } from "../config.ts"

export async function clean_command(root: string, flags: flags): Promise<void> {
    const out = output_directory(root, String(flags.out ?? "dist"))
    if (existsSync(out) && !existsSync(join(out, ".jazu_output.json"))) throw new Error("Refusing to clean output without .jazu_output.json")
    const cache = join(root, ".cache")
    if (existsSync(cache) && !inside(realpathSync(root), realpathSync(cache))) throw new Error("Cache junction escapes project")
    rmSync(out, { recursive: true, force: true })
    rmSync(cache, { recursive: true, force: true })
    return
}
