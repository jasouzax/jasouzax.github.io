import { resolve, dirname, join } from "node:path"
import { existsSync } from "node:fs"
import { once } from "node:events"
import type { Server } from "node:http"
import { serve_command } from "./step/serve.ts"
import { host_command } from "./step/host.ts"
/* Ordered CLI composition of implemented steps. Long-running steps release the next step after startup. */
import { spawn } from "node:child_process"
import { parse_args } from "./config.ts"
import { run_command } from "./commands.ts"

export const step_order = ["test", "make", "watch", "serve", "host", "cloud", "server"]
const aliases: Record<string, string> = { build: "make", deploy: "cloud", node: "server" }

export function expand_steps(words: string[]): string[] {
    return words.flatMap(word => {
        if (word === "all") return step_order
        const range = /^(test|make|watch|serve|host|cloud|server)-(test|make|watch|serve|host|cloud|server)$/.exec(word)
        if (!range) return [aliases[word] ?? word]
        const first = step_order.indexOf(range[1]), last = step_order.indexOf(range[2])
        if (first > last) throw new Error(`Pipeline range must run forward: ${word}`)
        return step_order.slice(first, last + 1)
    })
}

async function npm_step(args: string[], background = false): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        const candidates = [process.env.npm_execpath, join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"), join(dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js")].filter((file): file is string => !!file)
        const npm_cli = process.platform === "win32" ? candidates.find(file => existsSync(file)) : undefined
        if (process.platform === "win32" && !npm_cli) { reject(new Error("Cannot locate npm CLI")); return }
        const child = spawn(npm_cli ? process.execPath : "npm", npm_cli ? [npm_cli, ...args] : args, { stdio: background ? ["inherit", "pipe", "pipe"] : "inherit", windowsHide: true })
        child.on("error", reject)
        child.on("exit", code => code === 0 ? resolve() : reject(new Error(`npm ${args.join(" ")} exited ${code}`)))
        if (background) {
            const output = (bytes: Buffer) => { process.stdout.write(bytes); if (/Ready on|Local:\s+http|listening/i.test(bytes.toString())) resolve() }
            child.stdout?.on("data", output)
            child.stderr?.on("data", output)
        }
        for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => child.kill(signal))
    })
}

export async function run_pipeline(args: string[]): Promise<void> {
    const { words } = parse_args(args)
    if (!words.length || !step_order.includes(aliases[words[0]] ?? words[0].split(":")[0]) && words[0] !== "all" && !words[0].includes("-")) return run_command(args)
    if (words[0] === "server" && words.length > 1 && ["init", "repo", "user", "run", "status", "sync"].includes(words[1])) return run_command(args)
    const options = args.filter((value, index) => !words.includes(value) || index > 0 && args[index - 1].startsWith("--"))
    let static_server: Server | undefined
    const flags = parse_args(options).flags, root = resolve(String(flags.root ?? process.cwd()))
    for (const step of expand_steps(words)) {
        if (step === "test:ts") await npm_step(["run", "types"])
        else if (step === "test:engine") await npm_step(["run", "test:engine"])
        else if (step === "test:content") { await npm_step(["run", "test:content"]); await run_command(["check", ...options]) }
        else if (step === "test:icon") await run_command(["icons", "check", ...options])
        else if (step === "test") { await npm_step(["run", "types"]); await npm_step(["test"]); await run_command(["check", ...options]) }
        else if (step === "make") await run_command(["build", ...options])
        else if (step === "cloud") await run_command(["deploy", ...options])
        else if (step === "server") (await import("../server/main.ts")).start_listener(root, flags)
        else if (step === "host") {
            if (static_server) { static_server.close(); await once(static_server, "close"); static_server = undefined }
            await host_command(root, flags, npm_step)
        }
        else if (step === "serve") static_server = await serve_command(root, flags)
        else if (step === "watch") await run_command([step, ...options])
        else throw new Error(`Unknown pipeline step: ${step}`)
    }
}
