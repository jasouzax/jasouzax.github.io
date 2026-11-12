#!/usr/bin/env node
import { register } from "tsx/esm/api"
import { fileURLToPath } from "node:url"
register({ tsconfig: fileURLToPath(new URL("../tsconfig.json", import.meta.url)) })
if (process.argv[2] === "node") (await import("./node/listener_main.ts")).listener_command()
else await import("./commands.ts")
