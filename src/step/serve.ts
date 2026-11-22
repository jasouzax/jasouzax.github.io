import { existsSync } from "node:fs"
/* Existing CLI serve behavior, owned by its step. */
import { resolve, join } from "node:path"
import { serve } from "./serve_http.ts"
import { show, run_build } from "./make.ts"
import type { flags } from "../config.ts"

export async function serve_command(root: string, flags: flags): Promise<void> {
    if (!existsSync(join(root, String(flags.out ?? "dist"), ".jazu_output.json"))) show(await run_build(root, flags, false))
    serve(resolve(root, String(flags.out ?? "dist")), Number(flags.port ?? 8080))
    return
}
