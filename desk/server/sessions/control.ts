/** Restart uses the existing stop/status/start contract, including older personal servers. */
import type { Server_Link } from "../link.ts"
type Link = Pick<Server_Link, "send" | "on">
export function restart_session(link: Link, path: string, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        let starting = false, done = false
        const releases: (() => void)[] = []
        const finish = (error?: Error) => {
            if (done) return
            done = true; clearTimeout(timer); releases.forEach(release => release()); signal?.removeEventListener("abort", cancel)
            error ? reject(error) : resolve()
        }
        const cancel = () => finish(new Error("Session restart was cancelled"))
        const timer = setTimeout(() => finish(new Error("The server did not acknowledge the session restart")), 15000)
        releases.push(link.on("auto_status", message => {
            if (message.path !== path || done) return
            if (starting) { if (message.running || message.autostart) finish(); return }
            if (message.running || message.autostart || message.restarting) return
            starting = true
            if (!link.send({ t: "auto_start", path })) finish(new Error("The server is offline"))
        }), link.on("auto_error", message => { if (message.path === path) finish(new Error(String(message.message || "Session restart failed"))) }),
            link.on("auto_deleted", message => { if (message.path === path) cancel() }), link.on("disconnected", () => finish(new Error("The server disconnected"))))
        if (signal?.aborted) { cancel(); return }
        signal?.addEventListener("abort", cancel, { once: true })
        if (!link.send({ t: "auto_stop", path })) finish(new Error("The server is offline"))
    })
}
