#!/usr/bin/env node
import { register } from "tsx/esm/api"
import { fileURLToPath } from "node:url"
register({ tsconfig: fileURLToPath(new URL("../tsconfig.json", import.meta.url)) })
if (process.argv[2] === "node") (await import("../server/main.ts")).listener_command()
else {
    try { await (await import("./pipeline.ts")).run_pipeline(process.argv.slice(2)) }
    catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1 }
}
