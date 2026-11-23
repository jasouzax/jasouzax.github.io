/* Supervise a single API child with bounded IPC, startup and handler deadlines. */
import { fork, type ChildProcess } from "node:child_process"
import { api_failure, api_limit, type Api_Call, type Api_Manifest, type Api_Result } from "../../shared/api/types.ts"
export class Api_Process {
    readonly child: ChildProcess
    readonly ready: Promise<Api_Manifest>
    readonly stopped: Promise<void>
    readonly pending = new Map<number, { resolve: (result: Api_Result) => void, timer: ReturnType<typeof setTimeout> }>()
    private sequence = 0
    manifest: Api_Manifest | null = null
    constructor(entry: string, release: string, source: string, exited: () => void, log: (text: string) => void) {
        const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
        this.child = fork(entry, [release, source], { env, stdio: ["ignore", "pipe", "pipe", "ipc"], execArgv: [], windowsHide: true })
        this.stopped = new Promise(resolve => { this.child.once("exit", () => resolve()); this.child.once("error", () => resolve()) })
        this.child.stdout?.on("data", bytes => log(String(bytes).slice(0, 4096)))
        this.child.stderr?.on("data", bytes => log(String(bytes).slice(0, 4096)))
        this.ready = new Promise((resolve, reject) => {
            const timer = setTimeout(() => { this.child.kill("SIGKILL"); reject(new Error("API startup timed out")) }, 10000)
            const fail = () => { clearTimeout(timer); reject(new Error("API process exited before readiness")) }
            this.child.once("error", fail); this.child.once("exit", fail)
            this.child.on("message", (message: any) => {
                if (message?.type === "ready" && !this.manifest) { clearTimeout(timer); this.manifest = message.manifest; resolve(message.manifest) }
                if (message?.type === "fatal") { clearTimeout(timer); reject(new Error(String(message.message))); this.terminate() }
                if (message?.type === "result") {
                    const pending = this.pending.get(message.id)
                    if (!pending) return
                    this.pending.delete(message.id); clearTimeout(pending.timer)
                    if (Buffer.byteLength(JSON.stringify(message.result)) > api_limit + 8192) pending.resolve(api_failure("response_too_large", "API response exceeds transport limit", 502))
                    else pending.resolve(message.result)
                }
            })
        })
        this.child.once("exit", () => { for (const request of this.pending.values()) { clearTimeout(request.timer); request.resolve(api_failure("api_offline", "API process is unavailable", 503)) }; this.pending.clear(); exited() })
    }
    call(call: Api_Call, deadline_ms = 31000): Promise<Api_Result> {
        if (!this.child.connected || !this.manifest) return Promise.resolve(api_failure("api_offline", "API process is unavailable", 503, call.request_id))
        if (this.pending.size >= 32) return Promise.resolve(api_failure("busy", "API has too many pending requests", 503, call.request_id))
        const id = ++this.sequence
        return new Promise(resolve => {
            const timer = setTimeout(() => { this.pending.delete(id); resolve(api_failure("timeout", "API process timed out", 504, call.request_id)); this.child.kill("SIGKILL") }, deadline_ms)
            this.pending.set(id, { resolve, timer })
            this.child.send({ type: "call", id, call }, error => { if (error) { clearTimeout(timer); this.pending.delete(id); resolve(api_failure("api_offline", "API process is unavailable", 503, call.request_id)) } })
        })
    }
    terminate(): void {
        this.child.kill()
        const timer = setTimeout(() => this.child.kill("SIGKILL"), 1000)
        timer.unref(); void this.stopped.then(() => clearTimeout(timer))
    }
    activate(): void { if (this.child.connected) this.child.send({ type: "activate" }, () => {}) }
    stop(): void {
        if (!this.pending.size) { this.terminate(); return }
        // Replaced releases drain existing requests while new requests already use the new process.
        const timer = setInterval(() => { if (!this.pending.size) { clearInterval(timer); this.terminate() } }, 20)
        setTimeout(() => { clearInterval(timer); this.child.kill("SIGKILL") }, 32000).unref()
    }
}
