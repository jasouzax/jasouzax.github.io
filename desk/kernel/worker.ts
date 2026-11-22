/* One worker ABI for every compiled program; program manifests supply loaders. */
import type { worker_start } from "./wasm_protocol.ts"
import { run_worker_runtime } from "./worker_runtime.ts"
export async function run_worker(start: worker_start, send: (value: unknown) => void, create?: (options: any) => Promise<any>, applet = false, adapter?: (start: worker_start, send: (value: unknown) => void) => Promise<void>): Promise<void> {
    try {
        if (adapter) return adapter(start, send)
        if (start.runtime) return (await import(start.runtime)).run_program(start, send)
        if (!create) {
            if (!start.loader) throw new Error("Program has no loader")
            create = (await import(start.loader)).default
            applet = start.applet ?? false
        }
        await run_worker_runtime(start, send, create!, applet)
    } catch (error) { send({ failure: error instanceof Error ? error.message : String(error) }) }
}
const scope = globalThis as unknown as { postMessage(value: unknown): void, onmessage: ((event: MessageEvent<worker_start>) => void) | null }
if (typeof scope.postMessage === "function") scope.onmessage = event => { void run_worker(event.data, value => scope.postMessage(value)) }
