/* One OS process per authored API script and version. No HTTP port, VM sandbox or container per API. */
import { readFileSync } from "node:fs"
import { dirname } from "node:path"
import { createRequire } from "node:module"
import { Runtime_API } from "./runtime.ts"
import type { Api_Call, Api_Config } from "../../shared/api/types.ts"

const [release, source] = process.argv.slice(2)
let instance: Runtime_API | null = null
const send = (message: unknown) => { if (process.connected) process.send?.(message) }
class API extends Runtime_API {
    constructor(config: Api_Config) {
        if (instance) throw new Error("One API per script process; deploy versions as separate scripts")
        super(config, dirname(source)); instance = this
    }
}
const close = () => { try { instance?.close() } finally { process.exit(0) } }
process.on("disconnect", close)
process.on("SIGTERM", close)
process.on("uncaughtException", () => { send({ type: "fatal", message: "API child failed" }); process.exit(1) })
process.on("unhandledRejection", () => { send({ type: "fatal", message: "API child rejected an asynchronous task" }); process.exit(1) })
process.on("message", (value: any) => {
    if (value?.type === "activate" && instance) { instance.activate(); return }
    if (value?.type !== "call" || !instance) return
    void instance.dispatch(value.call as Api_Call).then(result => send({ type: "result", id: value.id, result }), () => send({ type: "fatal", message: "API dispatcher failed" }))
})
async function main(): Promise<void> {
    const Async_Function = Object.getPrototypeOf(async function () {}).constructor
    const run = new Async_Function("API", "require", "__filename", "__dirname", readFileSync(release, "utf8"))
    await run(API, createRequire(source), source, dirname(source))
    if (!instance) throw new Error("Script must construct an API")
    ;(instance as Runtime_API).seal()
    send({ type: "ready", manifest: (instance as Runtime_API).manifest() })
}
void main().catch(() => { send({ type: "fatal", message: "API script could not start" }); process.exit(1) })
