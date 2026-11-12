/* Process primitives shared by the listener bootstrap and short-lived pipeline workers; no content/schema imports. */
import { spawn } from "node:child_process"
import { existsSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import type { Server_Config } from "./server_config.ts"
import type { Log, Step_Command, Step_Result } from "./pipeline.ts"

type Command_Output = { result: Step_Result, tail: string }
const minutes = (count: number) => count * 60_000

// Execute npm through its Node CLI on Windows so arguments never pass through cmd.exe.
function executable(step: Step_Command): { command: string, args: string[] } {
    if (step.command === "node") return { command: process.execPath, args: step.args }
    if (process.platform === "win32" && ["npm", "npx", "npm.cmd", "npx.cmd"].includes(step.command)) {
        const name = step.command.startsWith("npx") ? "npx-cli.js" : "npm-cli.js"
        const candidates = [join(dirname(process.execPath), "node_modules/npm/bin", name), join(dirname(process.execPath), "../lib/node_modules/npm/bin", name)]
        if (process.env.npm_execpath) candidates.unshift(join(dirname(process.env.npm_execpath), name))
        const entry = candidates.find(file => existsSync(file))
        if (!entry) throw new Error("Cannot locate npm's Node CLI; run the node through the installed Node/npm environment")
        return { command: process.execPath, args: [entry, ...step.args] }
    }
    if (process.platform === "win32" && /\.(cmd|bat)$/i.test(step.command)) throw new Error("Use an executable or node script instead of a cmd/bat pipeline command")
    return { command: step.command, args: step.args }
}

export function child_environment(config: Server_Config, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
    const home = join(config.state_dir, "home")
    mkdirSync(home, { recursive: true })
    const kept: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: home, CI: "true" }
    for (const name of ["SystemRoot", "ComSpec", "PATHEXT", "TEMP", "TMP", "LANG", "LC_ALL"]) if (process.env[name]) kept[name] = process.env[name]
    return { ...kept, ...extra }
}

export function run_command(step: Step_Command, cwd: string, env: NodeJS.ProcessEnv, log: Log, extra_args: string[] = []): Promise<Command_Output> {
    return new Promise(resolve_output => {
        const started = Date.now()
        log(`\n$ ${step.command} ${[...step.args, ...extra_args].join(" ")}   (${cwd})\n`)
        const resolved = executable({ ...step, args: [...step.args, ...extra_args] })
        const child = spawn(resolved.command, resolved.args, { cwd, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true })
        let tail = ""
        const timer = setTimeout(() => { log(`\n[timeout after ${step.timeout_ms}ms]\n`); child.kill("SIGKILL") }, step.timeout_ms ?? minutes(10))
        const forward = (chunk: Buffer) => { const text = chunk.toString("utf8"); log(text); tail = (tail + text).slice(-20_000) }
        child.stdout.on("data", forward)
        child.stderr.on("data", forward)
        const done = (code: number | null, note?: string) => {
            clearTimeout(timer)
            if (note) log(`\n[${note}]\n`)
            resolve_output({ result: { name: step.name, ok: code === 0, code, ms: Date.now() - started }, tail })
        }
        child.on("error", error => done(null, `could not start: ${error.message}`))
        child.on("close", code => done(code))
    })
}

