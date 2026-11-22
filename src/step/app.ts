/* Build the website and independent Electron package, then release only when the desktop exits. */
import { spawn } from "node:child_process"
import { createRequire } from "node:module"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { once } from "node:events"
import { serve_command } from "./serve.ts"
import type { flags } from "../config.ts"

export async function app_command(root: string, flags: flags): Promise<void> {
    const directory = join(root, "app"), require = createRequire(join(directory, "package.json"))
    if (!existsSync(join(directory, "node_modules", "electron"))) throw new Error("Install desktop dependencies first: npm --prefix app ci")
    const build = spawn(process.execPath, [join(directory, "build.mjs")], { cwd: root, stdio: "inherit", windowsHide: true })
    const [code] = await once(build, "exit")
    if (code !== 0) throw new Error("Desktop build failed")
    const server = await serve_command(root, { ...flags, host: "127.0.0.1", port: "0" })
    if (!server.listening) await once(server, "listening")
    const port = (server.address() as { port: number }).port
    const env: NodeJS.ProcessEnv = { ...process.env, JAZU_APP_URL: `http://localhost:${port}/desk` }
    delete env.ELECTRON_RUN_AS_NODE
    const child = spawn(require("electron"), [directory, ...(flags.kiosk ? ["--kiosk"] : [])], { cwd: root, stdio: "inherit", env, windowsHide: false })
    try { const [exit] = await once(child, "exit"); if (exit !== 0) throw new Error(`Desktop exited ${exit}`) }
    finally { server.close(); server.closeIdleConnections() }
}
