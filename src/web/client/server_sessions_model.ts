import type { Script_Info, Window_Info } from "../../../server/src/shared/protocol.ts"

export type Session = { path: string, running: boolean, windows: Window_Info[] }
export class Session_Store {
    readonly #scripts = new Map<string, boolean>()
    apply(message: { t: string, [key: string]: unknown }): void {
        if (message.t === "auto_state") {
            this.#scripts.clear()
            for (const script of message.scripts as Script_Info[]) this.#scripts.set(script.path, script.running)
        } else if (message.t === "auto_status") this.#scripts.set(String(message.path), Boolean(message.running))
        else if (message.t === "auto_deleted") this.#scripts.delete(String(message.path))
    }
    clear(): void { this.#scripts.clear() }
    list(windows: Window_Info[]): { scripts: Session[], windows: Window_Info[] } {
        const scripts = [...this.#scripts].map(([path, running]) => ({ path, running, windows: windows.filter(window => window.script === path) }))
        const parents = new Set(scripts.map(script => script.path))
        return { scripts, windows: windows.filter(window => !parents.has(window.script)) }
    }
}
