#!/usr/bin/env node
import { fileURLToPath } from "node:url"
const bootstrap_only = process.argv[2] === "inst" && process.argv.length === 3
// Bootstrap must precede loading any installed dependencies.
if (process.argv[2] === "inst") {
    await (await import("./step/inst.ts")).inst_command(process.cwd())
    process.argv.splice(2, 1)
    if (process.argv.length === 2) process.exit(0)
}
if (!bootstrap_only) {
    const { register } = await import("tsx/esm/api")
    register({ tsconfig: fileURLToPath(new URL("../tsconfig.json", import.meta.url)) })
    if (process.argv[2] === "node") (await import("../server/main.ts")).listener_command()
    else {
        try { await (await import("./pipeline.ts")).run_pipeline(process.argv.slice(2)) }
        catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1 }
    }
}
