/* Container health probe: website JSON health, or a signed personal-server health request. */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { sign_origin } from "../../src/node/security.ts"

const config = JSON.parse(readFileSync("/tmp/jazu-health.json", "utf8"))
const target = new URL(config.personal ? "/health" : "/api/v1/health", `http://127.0.0.1:${config.port}`)
const headers = config.personal ? await sign_origin(new Request(target), readFileSync(join(config.data, "origin-secret"), "utf8").trim(), "docker-health") : undefined
const response = await fetch(target, { headers, signal: AbortSignal.timeout(5000) })
if (!response.ok || (await response.json() as { status: string }).status !== "ok") process.exitCode = 1
