/*
 * Electron entry of the Pi agent: builds the collaborators once and connects them to the Worker.
 *
 * Entities
 *   main   reads server/.env, creates the window registry, script runner, API registry, terminals, sites and the Agent, then dials the Worker
 *
 * Limits
 *   Holds no logic of its own: every rule lives in the module it composes, so this file is the one place that needs Electron to run.
 *   The agent has to outlive every window (Web.keep_alive): pages come and go while scripts run.
 */
import { app } from "electron"
import { config as load_env } from "dotenv"
import * as path from "path"
import { Auto_Start } from "./autostart"
import { Agent } from "./agent"
import { Api_Registry } from "./api"
import { parse_config } from "./config"
import { take_snapshot } from "./fastfetch"
import { read_text } from "./fs_channel"
import { Hub_Link } from "./link"
import { open_ws } from "./link_ws"
import { Pty_Channel } from "./pty_channel"
import { Script_Runner } from "./runner"
import { sign_upgrade } from "./sign"
import { Site_Registry } from "./sites"
import { Web } from "./web"
import { Window_Registry } from "./windows"
import { protocol_version } from "../../shared/protocol/wire.ts"

Web.keep_alive = true

async function main(): Promise<void> {
    await app.whenReady()
    const root = app.getAppPath()
    load_env({ path: path.join(root, ".env"), quiet: true })
    const config = parse_config(process.env, root)
    const log = (line: string) => console.log(`[server] ${line}`)
    const windows = new Window_Registry(root)
    const apis = new Api_Registry()
    const runner = new Script_Runner({ read_source: script_path => read_text(config.fs_root, script_path), web_class: Web, apis, root, autostart: new Auto_Start(path.join(root, "user_data", "autostart.json")) })
    runner.on("web", (script_path: string, web: Web) => windows.track(script_path, web))
    const sites = new Site_Registry({ make_web: url => new Web(url), windows })
    const link = new Hub_Link({
        url: `${config.origin.replace(/^http/, "ws")}/api/_/server/agent`,
        sign: url => sign_upgrade(config.secret, url),
        open: open_ws,
        app: "jazu-server",
        platform: `${process.platform}-${process.arch}`,
        log,
    })
    const pty = new Pty_Channel({ shim: path.join(root, "assets", "pty_shim.py"), send: (message, to) => link.send(message, to), buffered: () => link.buffered })
    const agent = new Agent({ link, runner, windows, sites, apis, pty, fs_root: config.fs_root, snapshot: () => take_snapshot(config.fastfetch_structure) })
    link.on_message = message => agent.handle(message)
    link.on_open = () => agent.publish_apis()
    link.on_close = () => agent.on_link_closed()
    app.on("before-quit", () => { link.stop(); pty.close_all(); void runner.shutdown(); void sites.close_all() })
    link.start()
    await runner.restore()
    log(`agent (protocol ${protocol_version}) for ${config.origin}, file system root ${config.fs_root}`)
}

main().catch(error => {
    console.error("[server] failed to start:", error instanceof Error ? error.message : error)
    app.exit(1)
})
