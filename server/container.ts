/* Bootstrap persistent personal-server containers and restore missing build inputs. */
import { spawn, spawnSync } from "node:child_process"
import { randomBytes, createHash } from "node:crypto"
import { readdirSync, cpSync, existsSync, mkdirSync, lstatSync, readlinkSync, statSync, unlinkSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { load_project_declarations } from "../shared/content/catalog.ts"
import { inside } from "../shared/paths.ts"
const application = resolve(dirname(fileURLToPath(import.meta.url)), "..")
export type Container_Options = { personal: boolean, runner: boolean, data: string, host: string, port: number, config?: string }
function run(command: string, args: string[], cwd: string): void {
    const result = spawnSync(command, args, { cwd, env: process.env, stdio: "inherit", windowsHide: true })
    if (result.status !== 0) throw new Error(`${command} ${args[0]} failed (${result.status ?? result.error?.message})`)
}
function health(options: Container_Options): void {
    writeFileSync("/tmp/jazu-health.json", JSON.stringify({ personal: options.personal, port: options.port, data: options.data }))
}
export function restore_inputs(image: string, work: string): void {
    const repair_image_links = (path: string): void => {
        let stat
        try { stat = lstatSync(path) } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error }
        if (stat.isSymbolicLink()) {
            const target = resolve(dirname(path), readlinkSync(path))
            // Earlier images copied their deduplication links into /data. Materialize those links before restoring.
            if (inside(resolve(image), target)) unlinkSync(path)
        } else if (stat.isDirectory()) for (const name of readdirSync(path)) repair_image_links(join(path, name))
    }
    for (const name of ["build", "content/media"]) if (existsSync(join(image, name))) {
        // Git tracks custom compiler sources inside build/; its existence does not mean artifacts were restored.
        repair_image_links(join(work, name))
        cpSync(join(image, name), join(work, name), { recursive: true, dereference: true, force: false, errorOnExist: false, filter: (source, destination) => {
            try { const destination_stat = lstatSync(destination); return destination_stat.isDirectory() && statSync(source).isDirectory() }
            catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return true; throw error }
        } })
    }
}

export function personal(options: Container_Options): void {
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
