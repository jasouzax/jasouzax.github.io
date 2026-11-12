/* Short-lived engine worker. Never imported by the listener; every invocation loads modules from disk anew. */
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { load_server_config } from "./server_config.ts"
import { run_pipeline } from "./pipeline.ts"

async function main(): Promise<void> {
    const chunks: Buffer[] = []
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
    const input = JSON.parse(Buffer.concat(chunks).toString("utf8"))
    if (process.argv[2] === "catalog") {
        process.stdout.write(JSON.stringify(load_server_config(input.file, input.legacy)))
        return
    }
    if (process.argv[2] !== "run") throw new Error("Unknown engine worker mode")
    const config = load_server_config(input.config.file, JSON.parse(process.env.JAZU_REPOSITORIES_JSON ?? "{}"), input.catalog_dir)
    const record = input.record
    const save = () => writeFileSync(join(config.state_dir, "runs", `${input.job.id}.json`), JSON.stringify(record, null, 2))
    await run_pipeline(config, input.job, record, text => process.stdout.write(text), save)
}

main().catch(error => { console.error(error instanceof Error ? error.stack : error); process.exitCode = 1 })
