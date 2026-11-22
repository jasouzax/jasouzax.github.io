/* Dependency bootstrap uses only Node builtins so it works before npm ci. */
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"

export async function inst_command(root: string): Promise<void> {
    const candidates = [process.env.npm_execpath, join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"), join(dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js")]
    const cli = candidates.find(file => file && existsSync(file))
    if (!cli && process.platform === "win32") throw new Error("Cannot locate npm CLI; install npm alongside Node")
    await new Promise<void>((resolve, reject) => {
        const child = spawn(cli ? process.execPath : "npm", cli ? [cli, "ci"] : ["ci"], { cwd: root, stdio: "inherit", windowsHide: true })
        child.once("error", reject)
        child.once("exit", code => code === 0 ? resolve() : reject(new Error(`npm ci exited ${code}`)))
    })
}
