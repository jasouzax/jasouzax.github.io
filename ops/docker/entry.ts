/*
 * Container entry: default prebuilt website, custom read-only content build, or durable personal server.
 * The image contains tools/artifacts, never server credentials. Personal state and the live engine checkout
 * live under /data; listener restarts load that checkout's updated code rather than the immutable image copy.
 */
import { spawn, spawnSync } from "node:child_process"
import { randomBytes, createHash } from "node:crypto"
import { cpSync, existsSync, mkdirSync, mkdtempSync, lstatSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { serve } from "../../src/node/serve.ts"
import { load_project_declarations } from "../../src/node/project_catalog.ts"

const application = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
export type Docker_Options = { personal: boolean, runner: boolean, content?: string, config?: string, data: string, host: string, port: number, base_url?: string }

export function docker_options(args: string[], env: NodeJS.ProcessEnv = process.env): Docker_Options {
    const values: Record<string, string> = {}
    let personal = false, runner = true
    for (let index = 0; index < args.length; index++) {
        const arg = args[index]
        if (arg === "--personal-server") { personal = true; continue }
        if (arg === "--no-runner") { runner = false; continue }
        const match = /^--(content|config|data|host|port|base_url)(?:=(.*))?$/.exec(arg)
        if (!match) throw new Error(`Unknown container argument ${arg}`)
        const value = match[2] ?? args[++index]
        if (!value || value.startsWith("--")) throw new Error(`Missing value for --${match[1]}`)
        values[match[1]] = value
    }
    const port = Number(values.port ?? (personal ? 8788 : 8080))
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("port must be between 1 and 65535")
    return { personal, runner, content: values.content, config: values.config, data: resolve(values.data ?? env.JAZU_DATA_DIR ?? "/data"), host: values.host ?? "0.0.0.0", port, base_url: values.base_url }
}

function run(command: string, args: string[], cwd: string): void {
    const result = spawnSync(command, args, { cwd, env: process.env, stdio: "inherit", windowsHide: true })
    if (result.status !== 0) throw new Error(`${command} ${args[0]} failed (${result.status ?? result.error?.message})`)
}

function health(options: Docker_Options): void {
    writeFileSync("/tmp/jazu-health.json", JSON.stringify({ personal: options.personal, port: options.port, data: options.data }))
}

export function refresh_content(source: string, root: string): void {
    mkdirSync(root, { recursive: true })
    const pending = mkdtempSync(join(root, ".content-"))
    try {
        cpSync(source, pending, { recursive: true })
        rmSync(join(root, "content"), { recursive: true, force: true })
        renameSync(pending, join(root, "content"))
    } finally { rmSync(pending, { recursive: true, force: true }) }
}

export function custom_site(options: Docker_Options): string {
    if (!options.content || !existsSync(options.content)) throw new Error("Mount custom content with --mount type=bind,src=<host-directory>,dst=/content,readonly and pass --content=/content")
    const root = join(options.data, "website")
    mkdirSync(root, { recursive: true })
    // Copy into a writable workspace; never generate files inside the owner's read-only content mount.
    refresh_content(options.content, root)
    cpSync(options.config ?? join(application, "config.json"), join(root, "config.json"))
    for (const name of ["src", "build", "node_modules"]) if (!existsSync(join(root, name))) symlinkSync(join(application, name), join(root, name), "dir")
    for (const name of ["package.json", "package-lock.json", "tsconfig.json"]) cpSync(join(application, name), join(root, name))
    const args = [join(application, "src/main.ts"), "build", "--root", root, "--force"]
    if (options.base_url) args.push("--base_url", options.base_url)
    run(process.execPath, args, root)
    return join(root, "dist")
}

export function restore_inputs(image: string, work: string): void {
    for (const name of ["build", "content/media"]) if (existsSync(join(image, name))) {
        // Git tracks custom compiler sources inside build/; its existence does not mean artifacts were restored.
        cpSync(join(image, name), join(work, name), { recursive: true, force: false, errorOnExist: false, filter: (source, destination) => {
            try { const destination_stat = lstatSync(destination); return destination_stat.isDirectory() && lstatSync(source).isDirectory() }
            catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return true; throw error }
        } })
    }
}

function personal(options: Docker_Options): void {
    process.umask(0o077)
    mkdirSync(options.data, { recursive: true })
    process.env.HOME = join(options.data, "home")
    mkdirSync(process.env.HOME, { recursive: true })
    const secret_file = join(options.data, "origin-secret")
    process.env.ORIGIN_HMAC_SECRET ||= process.env.HMAC_SECRET || (existsSync(secret_file) ? readFileSync(secret_file, "utf8").trim() : randomBytes(32).toString("hex"))
    writeFileSync(secret_file, process.env.ORIGIN_HMAC_SECRET, { mode: 0o600 })
    const file = resolve(options.config ?? join(options.data, "server.json"))
    const project = process.env.JAZU_ENGINE_PROJECT ?? "jazu"
    if (!existsSync(file)) writeFileSync(file, JSON.stringify({ repos_dir: join(options.data, "repos"), state_dir: join(options.data, "state"), site: { project, dir: join(options.data, "work", project), branch: "master" }, projects: {}, collaborators: {} }, null, 2), { mode: 0o600 })
    const config = JSON.parse(readFileSync(file, "utf8"))
    const work = resolve(dirname(file), config.site.dir)
    if (!existsSync(join(work, ".git"))) {
        const remote = process.env.JAZU_ENGINE_REPO ?? load_project_declarations(application).get(project)?.remote
        if (!remote) throw new Error("Restore the personal-server data volume or set JAZU_ENGINE_REPO to its engine Git repository")
        mkdirSync(dirname(work), { recursive: true })
        run("git", ["clone", "--branch", process.env.JAZU_ENGINE_BRANCH ?? config.site.branch, remote, work], options.data)
    }
    restore_inputs(application, work)
    const lock = createHash("sha256").update(readFileSync(join(work, "package-lock.json"))).digest("hex")
    const image_lock = createHash("sha256").update(readFileSync(join(application, "package-lock.json"))).digest("hex")
    const marker = join(options.data, "engine-dependencies")
    const stamp = `${process.platform}/${process.arch}:${lock}`
    const modules = join(work, "node_modules")
    if (!existsSync(modules) && lock === image_lock) {
        cpSync(join(application, "node_modules"), modules, { recursive: true })
        writeFileSync(marker, stamp)
    } else if (!existsSync(modules) || !existsSync(marker) || readFileSync(marker, "utf8") !== stamp) {
        run("npm", ["ci", "--include=dev", "--no-audit", "--no-fund"], work)
        writeFileSync(marker, stamp)
    }
    process.env.JAZU_LISTEN_HOST = options.host
    if (!options.runner) process.env.JAZU_DISABLE_RUNNER = "1"
    health(options)
    const child = spawn(process.execPath, [join(work, "src/main.ts"), "node", "--root", work, "--config", file, "--port", String(options.port)], { cwd: work, env: process.env, stdio: "inherit" })
    for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => child.kill(signal))
    child.on("error", error => { console.error(error.message); process.exitCode = 1 })
    child.on("exit", code => process.exit(code ?? 1))
}

async function main(): Promise<void> {
    const options = docker_options(process.argv.slice(2))
    mkdirSync(options.data, { recursive: true })
    if (options.personal) return personal(options)
    const out = options.content ? custom_site(options) : join(application, "dist")
    health(options)
    const server = serve(out, options.port, options.host)
    for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => server.close(() => process.exit(0)))
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(error => { console.error(error.message); process.exitCode = 1 })
