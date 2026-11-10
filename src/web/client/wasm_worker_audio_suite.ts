import createProgram from "../../../build/audio_suite/audio_suite.js"
import type { worker_start } from "./wasm_protocol.ts"
import { run_worker_runtime } from "./wasm_worker_runtime.ts"
export function run_worker(start: worker_start, send: (value: unknown) => void): Promise<void> { return run_worker_runtime(start, send, createProgram) }
const scope = globalThis as unknown as { postMessage(value: unknown): void, onmessage: ((event: MessageEvent<worker_start>) => void) | null }
if (typeof scope.postMessage === "function") scope.onmessage = event => { void run_worker(event.data, value => scope.postMessage(value)) }
