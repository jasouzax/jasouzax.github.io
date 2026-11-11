/*
 * Installs (or removes) the native messaging host for the JAZU extension. Run: node extension/host/install.ts [options]
 * Entities:
 *   extension_id    - the Chrome extension id a manifest "key" produces (so the host can name exactly one allowed extension)
 *   native_manifest - the JSON Chrome reads to learn which program to start and which extension may start it
 *   main            - writes the launcher + manifests (or deletes them with --uninstall)
 * Scope:
 *   Writes only under extension/ and the browsers' NativeMessagingHosts folders. Needs no root unless --system is given.
 *   Options: --origin URL (page allowed to use the bridge, default http://localhost:8080), --user-data-dir DIR (repeatable), --system, --uninstall.
 */
import { createHash } from "node:crypto"
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export const host_name = "jazu.desk.host"

export function extension_id(key: string): string {
    const digest = createHash("sha256").update(Buffer.from(key, "base64")).digest("hex").slice(0, 32)
    return [...digest].map(char => String.fromCharCode(97 + parseInt(char, 16))).join("")
}

export function native_manifest(launcher: string, id: string): { name: string, description: string, path: string, type: "stdio", allowed_origins: string[] } {
    return { name: host_name, description: "JAZU desk device shell", path: launcher, type: "stdio", allowed_origins: [`chrome-extension://${id}/`] }
}

function parse_options(argv: string[]): { origin: string, dirs: string[], system: boolean, uninstall: boolean } {
    const options = { origin: "", dirs: [] as string[], system: false, uninstall: false }
    for (let index = 0; index < argv.length; index++) {
        const flag = argv[index]
        if (flag === "--system") options.system = true
        else if (flag === "--uninstall") options.uninstall = true
        else if (flag === "--origin" || flag === "--user-data-dir") {
            const value = argv[++index]
            if (!value) throw new Error(`${flag} needs a value`)
            if (flag === "--origin") options.origin = value
            else options.dirs.push(resolve(value))
        } else throw new Error(`unknown option ${flag}`)
    }
    return options
}

function check_origin(origin: string): string {
    const url = new URL(origin)
    if (url.protocol !== "http:" || url.hostname !== "localhost" || url.pathname !== "/" || url.search || url.hash) throw new Error("--origin must look like http://localhost:8080 (the desk is only ever served from localhost)")
    return url.origin
}

function check_node(): void {
    const [major, minor] = process.versions.node.split(".").map(Number)
    if (major < 22 || (major === 22 && minor < 18)) throw new Error(`Node 22.18 or newer is required (this is ${process.versions.node})`)
}

function main(): void {
    const options = parse_options(process.argv.slice(2))
    const host_dir = dirname(fileURLToPath(import.meta.url))
    const extension_dir = dirname(host_dir)
    const launcher = join(host_dir, "jazu-host")
    const id = extension_id(JSON.parse(readFileSync(join(extension_dir, "manifest.json"), "utf8")).key)
    // Chrome looks in the user-data-dir it runs with first, so a kiosk profile needs its own copy; the stock browsers are covered too
    const user_dirs = options.dirs.length ? options.dirs : [join(homedir(), ".config", "jazu-desk"), join(homedir(), ".config", "chromium"), join(homedir(), ".config", "google-chrome")]
    const targets = user_dirs.map(dir => join(dir, "NativeMessagingHosts"))
    if (options.system) targets.push("/etc/chromium/native-messaging-hosts", "/etc/opt/chrome/native-messaging-hosts")
    if (options.uninstall) {
        rmSync(launcher, { force: true })
        for (const target of targets) rmSync(join(target, `${host_name}.json`), { force: true })
        console.log(`removed the launcher and ${targets.length} manifest location(s)`)
        return
    }
    check_node()
    if (options.origin) writeFileSync(join(extension_dir, "allowed_origins.json"), JSON.stringify([check_origin(options.origin)]) + "\n")
    // Chrome starts the host with a minimal PATH, so the launcher pins the node that ran this installer (nvm and friends included)
    writeFileSync(launcher, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} --disable-warning=ExperimentalWarning ${JSON.stringify(join(host_dir, "host.ts"))} "$@"\n`)
    chmodSync(launcher, 0o755)
    const manifest = JSON.stringify(native_manifest(launcher, id), null, 4) + "\n"
    let written = 0
    for (const target of targets) {
        try {
            mkdirSync(target, { recursive: true })
            writeFileSync(join(target, `${host_name}.json`), manifest)
            console.log(`manifest: ${join(target, `${host_name}.json`)}`)
            written++
        } catch (error) {
            console.error(`skipped ${target}: ${(error as Error).message}`)
        }
    }
    if (written === 0) throw new Error("no manifest could be written")
    const origins = JSON.parse(readFileSync(join(extension_dir, "allowed_origins.json"), "utf8")) as string[]
    console.log(`extension id: ${id}\nallowed page origin(s): ${origins.join(", ")}\nlauncher: ${launcher}${existsSync(launcher) ? "" : " (missing!)"}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        main()
    } catch (error) {
        console.error(`install failed: ${(error as Error).message}`)
        process.exit(1)
    }
}
