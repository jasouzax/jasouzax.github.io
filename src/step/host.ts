/* Local Worker emulation owns the public port; Pages assets use a loopback-only ephemeral server. */
import { once } from "node:events"
import type { Server } from "node:http"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { output_directory } from "../../shared/paths.ts"
import type { flags } from "../config.ts"
import { run_build, show } from "./make.ts"
import { serve } from "./serve_http.ts"

export async function host_command(root: string, flags: flags, npm: (args: string[], background?: boolean) => Promise<void>): Promise<Server> {
    const port = Number(flags.port ?? 8080), host = String(flags.host ?? "0.0.0.0")
    if (!Number.isInteger(port) || port < 1 || port > 65535 || !/^[a-zA-Z0-9:.-]+$/.test(host)) throw new Error("Invalid emulation host or port")
    const out = output_directory(root, String(flags.out ?? "dist"))
    if (!existsSync(join(out, ".jazu_output.json"))) show(await run_build(root, flags, false))
    const assets = serve(out, 0, "127.0.0.1")
    try {
        await once(assets, "listening")
        const asset_port = (assets.address() as { port: number }).port
        await npm(["run", "db:local"])
        await npm(["run", "cloud:dev", "--", "--ip", host, "--port", String(port), "--var", `PAGES_ORIGIN:http://127.0.0.1:${asset_port}`], true)
        return assets
    } catch (error) { assets.close(); throw error }
}
