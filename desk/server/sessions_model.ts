import type { Script_Info, Window_Info } from "../../shared/protocol/wire.ts"

export type Session = { path: string, running: boolean, autostart?: boolean, restarting?: boolean, started_at?: number, restart_at?: number, windows: Window_Info[] }
export class Session_Store {
    readonly #scripts = new Map<string, Pick<Script_Info, "running" | "autostart" | "restarting" | "started_at" | "restart_at">>()
    apply(message: { t: string, [key: string]: unknown }): void {
        if (message.t === "auto_state") {
            this.#scripts.clear()
            for (const script of message.scripts as Script_Info[]) this.#scripts.set(script.path, { running: script.running, autostart: script.autostart, restarting: script.restarting, started_at: script.started_at, restart_at: script.restart_at })
        } else if (message.t === "auto_status") this.#scripts.set(String(message.path), { running: Boolean(message.running), autostart: Boolean(message.autostart), restarting: Boolean(message.restarting), started_at: typeof message.started_at === "number" ? message.started_at : undefined, restart_at: typeof message.restart_at === "number" ? message.restart_at : undefined })
        else if (message.t === "auto_deleted") this.#scripts.delete(String(message.path))
    }
    clear(): void { this.#scripts.clear() }
    list(windows: Window_Info[]): { scripts: Session[], windows: Window_Info[] } {
        const scripts = [...this.#scripts].map(([path, state]) => ({ path, ...state, windows: windows.filter(window => window.script === path) }))
        const parents = new Set(scripts.map(script => script.path))
        return { scripts, windows: windows.filter(window => !parents.has(window.script)) }
    }
}

export function session_description(session: Pick<Session, "running" | "restarting" | "started_at" | "restart_at">, now = Date.now()): string {
    if (session.restarting) return session.restart_at ? `Restarting in ${Math.max(0, Math.ceil((session.restart_at - now) / 1000))}s` : "Restarting"
    if (!session.running) return "Stopped"
    if (!session.started_at) return "Running"
    const seconds = Math.max(0, Math.floor((now - session.started_at) / 1000))
    return `Running ${Math.floor(seconds / 3600)}h ${Math.floor(seconds / 60) % 60}m ${seconds % 60}s`
}
