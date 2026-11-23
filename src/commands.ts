import { publish_command } from "./tools/publish.ts"
import { cloud_command } from "./step/cloud.ts"
import { make_command } from "./step/make.ts"
import { check_command } from "./step/test.ts"
import { serve_command } from "./step/serve.ts"
import { watch_command } from "./step/watch.ts"
import { clean_command } from "./tools/clean.ts"
import { graph_command } from "./tools/graph.ts"
/* CLI responsibilities for commands. */
import { resolve, dirname } from "node:path"

import { fileURLToPath } from "node:url"

import { server_command } from "./tools/server.ts"
import { api_command } from "./tools/api.ts"
import { parse_args } from "./config.ts"

import { icons_audit, icons_command } from "./tools/icons.ts"
import { pack_command } from "./tools/pack.ts"

export async function run_command(args = process.argv.slice(2)): Promise<void> {
    const { words, flags } = parse_args(args)
    const root = resolve(String(flags.root ?? process.cwd()))
    const command = words[0] ?? "build"
    if (command === "node") {
        (await import("../server/main.ts")).start_listener(root, flags)
        return
    }
    if (command === "server") {
        if (words[1] === "api") { await api_command(root, words.slice(2), flags); return }
        server_command(words.slice(1), flags, root)
        return
    }
    if (command === "publish") { await publish_command(root, flags); return }
    if (command === "deploy") { await cloud_command(root, flags); return }
    if (command === "build") { await make_command(root, flags); return }
    if (command === "check") { await check_command(root, flags); return }
    if (command === "serve") { await serve_command(root, flags); return }
    if (command === "watch") { await watch_command(root, flags); return }
    if (command === "clean") { await clean_command(root, flags); return }
    if (command === "icons") {
        if (words.length === 1 || words[1] === "check") await icons_audit(root, flags)
        else icons_command(root, words.slice(1))
        return
    }
    if (command === "graph") { await graph_command(root, flags); return }
    if (command === "pack") {
        // project dir is the parent of src/ (where this file lives), unless --root is given
        const project = flags.root ? root : dirname(dirname(fileURLToPath(import.meta.url)))
        await pack_command(project, String(flags.out_file ?? "codebase.zip"), words.slice(1))
        return
    }
    console.error(`unknown command "${command}". commands: build, check, serve, watch, clean, icons, graph, pack, deploy, publish, node, server`)
    process.exitCode = 1
}
