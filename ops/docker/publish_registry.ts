/* Publish a local Distribution registry's immutable blobs and final repository indexes to the public R2 registry. */
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
type Repository_Index = { schema: number, tags: Record<string, string>, manifests: Record<string, string>, blobs: string[] }
export function registry_indexes(storage: string): { indexes: Record<string, Repository_Index>, blobs: Record<string, string> } {
    const base = join(storage, "docker/registry/v2")
    const blobs: Record<string, string> = {}
    const walk = (path: string, visit: (file: string) => void) => {
        if (!existsSync(path)) return
        for (const item of readdirSync(path, { withFileTypes: true })) {
            const file = join(path, item.name)
            if (item.isDirectory()) walk(file, visit)
            else if (item.isFile()) visit(file)
        }
    }
    walk(join(base, "blobs/sha256"), file => { if (file.endsWith("/data") || file.endsWith("\\data")) blobs[`sha256:${file.split(/[\\/]/).at(-2)}`] = file })
    const indexes: Record<string, Repository_Index> = {}
    const repositories = join(base, "repositories")
    walk(repositories, file => {
        const parts = file.slice(repositories.length + 1).split(/[\\/]/)
        const marker = parts.findIndex(part => part.startsWith("_"))
        if (marker < 1 || parts.at(-1) !== "link") return
        const repository = parts.slice(0, marker).join("/")
        const index = indexes[repository] ??= { schema: 1, tags: {}, manifests: {}, blobs: [] }
        const digest = readFileSync(file, "utf8").trim()
        if (!/^sha256:[a-f0-9]{64}$/.test(digest) || !blobs[digest]) throw new Error(`Missing or invalid registry blob for ${repository}`)
        if (!index.blobs.includes(digest)) index.blobs.push(digest)
        if (parts[marker] !== "_manifests") return
        const manifest = JSON.parse(readFileSync(blobs[digest], "utf8"))
        if (typeof manifest.mediaType !== "string") throw new Error(`Manifest has no mediaType: ${digest}`)
        index.manifests[digest] = manifest.mediaType
        if (parts[marker + 1] === "tags" && parts.at(-2) === "current") index.tags[parts[marker + 2]] = digest
    })
    return { indexes, blobs }
}

async function main(): Promise<void> {
    const storage = resolve(process.argv[2] ?? "")
    const bucket = process.argv[3] ?? "jazu-registry"
    if (!process.argv[2]) throw new Error("usage: publish_registry.ts <local-registry-storage> [bucket]")
    const { indexes, blobs } = registry_indexes(storage)
    if (!Object.keys(indexes).length) throw new Error("No tagged images found in the local registry")
    const stage = join(root, ".cache/registry-publish")
    mkdirSync(stage, { recursive: true })
    const marker = join(stage, `${bucket}.json`)
    const done: Record<string, boolean> = existsSync(marker) ? JSON.parse(readFileSync(marker, "utf8")) : {}
    const put = (key: string, file: string) => new Promise<void>((resolve_upload, reject) => {
        const child = spawn(process.execPath, [join(root, "node_modules/wrangler/bin/wrangler.js"), "r2", "object", "put", `${bucket}/${key}`, "--file", file, "--remote", "--content-type", key.endsWith(".json") ? "application/json" : "application/octet-stream"], { cwd: root, env: { ...process.env, WRANGLER_SEND_METRICS: "false" }, stdio: ["ignore", "inherit", "inherit"] })
        child.on("error", reject)
        child.on("exit", code => code === 0 ? resolve_upload() : reject(new Error(`R2 upload failed for ${key}`)))
    })
    for (const file of Object.values(blobs)) if (statSync(file).size > 100 * 1024 * 1024) throw new Error("Compressed registry layer exceeds 100 MiB; split its inputs before publishing")
    const pending = Object.entries(blobs).filter(([digest]) => !done[digest])
    let next = 0
    await Promise.all(Array.from({ length: 3 }, async () => {
        for (;;) {
            const item = pending[next++]
            if (!item) return
            const [digest, file] = item
            if (`sha256:${createHash("sha256").update(readFileSync(file)).digest("hex")}` !== digest) throw new Error(`Registry blob integrity failure: ${digest}`)
            await put(`blobs/sha256/${digest.slice(7)}`, file)
            done[digest] = true
            writeFileSync(marker, JSON.stringify(done))
        }
    }))
    for (const [repository, index] of Object.entries(indexes)) {
        const file = join(stage, `${repository.replaceAll("/", "_")}.json`)
        writeFileSync(file, JSON.stringify(index))
        await put(`repos/${repository}/index.json`, file)
    }
    const catalog = join(stage, "catalog.json")
    writeFileSync(catalog, JSON.stringify({ repositories: Object.keys(indexes).sort() }))
    await put("catalog.json", catalog)
    console.log(`Published ${Object.keys(indexes).length} repositories; ${pending.length} new immutable blobs`)
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(error => { console.error(error.message); process.exitCode = 1 })
