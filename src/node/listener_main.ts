/*
 * Minimal persistent service entry: Git HTTP, repository polling, durable queue and child orchestration only.
 * Build/render commands are deliberately absent. Runtime changes exit 75 after the current job so the
 * service supervisor starts a fresh listener; systemd Restart=on-failure must remain enabled.
 */
import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { personal_server } from "./personal.ts"
import { load_server_config, is_public, repository_path } from "./server_config.ts"
import { sync_repositories } from "./git_hooks.ts"
import { start_runner, start_site_watcher } from "./runner.ts"

export function start_listener(root: string, flags: Record<string, string | boolean>): void {
    const legacy: Record<string, string> = JSON.parse(process.env.JAZU_REPOSITORIES_JSON ?? "{}")
    const file = resolve(root, String(flags.config ?? process.env.JAZU_SERVER_CONFIG ?? "server.json"))
    const config = existsSync(file) ? load_server_config(file, legacy) : undefined
    const repositories = config ? Object.fromEntries(Object.keys({ ...config.projects, [config.site.project]: 1 }).filter(id => is_public(config, id)).map(id => [id, repository_path(config, id)])) : legacy
    const server = personal_server({ secret: process.env.ORIGIN_HMAC_SECRET ?? "", repositories, port: Number(flags.port ?? 8788), config })
    if (!config) return console.log(`no ${file}: push and CI/CD are disabled (read-only Git API only)`)
    console.log(`hooks synced for: ${sync_repositories(config).join(", ") || "(no repositories yet)"}`)
    const runner = start_runner(config, { on_restart: () => {
        watcher.close()
        server.close(() => process.exit(75))
        server.closeIdleConnections()
        // Give an in-flight Git push the same grace as git_http.ts's ten-minute backend timeout.
        setTimeout(() => process.exit(75), 10 * 60_000 + 1000).unref()
    } })
    const watcher = start_site_watcher(config, runner.busy)
    for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { watcher.close(); runner.stop(); process.exit(0) })
}

export function listener_command(): void {
    const args = process.argv.slice(3)
    const flags: Record<string, string> = {}
    for (let index = 0; index < args.length; index += 2) {
        const name = args[index].replace(/^--/, "")
        if (!["root", "port", "config"].includes(name) || !args[index + 1]) throw new Error(`Unknown listener argument ${args[index]}`)
        flags[name] = args[index + 1]
    }
    start_listener(resolve(flags.root ?? process.cwd()), flags)
}
