import type { Server } from "node:http"
import { output_directory } from "../../shared/paths.ts"
import { existsSync } from "node:fs"
/* Existing CLI serve behavior, owned by its step. */
import { resolve, join } from "node:path"
import { serve } from "./serve_http.ts"
import { show, run_build } from "./make.ts"
import type { flags } from "../config.ts"

export async function serve_command(root: string, flags: flags): Promise<Server> {
    const out = output_directory(root, String(flags.out ?? "dist"))
    if (!existsSync(join(out, ".jazu_output.json"))) show(await run_build(root, flags, false))
    return serve(out, Number(flags.port ?? 8080), String(flags.host ?? "0.0.0.0"))
}
