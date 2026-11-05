import { cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import type { build_result } from "../build.ts"
import { output_file } from "../paths.ts"

export type asset_upload = { key: string, file: string, size: number, content_type: string }
const mime: Record<string, string> = { mp4: "video/mp4", webm: "video/webm", png: "image/png", jpg: "image/jpeg", avif: "image/avif", wasm: "application/wasm", mp3: "audio/mpeg", woff2: "font/woff2" }

export function prepare_deploy(root: string, out: string, result: build_result, limit = 25 * 1024 * 1024): { pages_config: string, worker_config: string, uploads: asset_upload[] } {
    // A unique staging folder prevents removed files from surviving between preparations.
    const stage = join(root, ".cache", "deploy", `${Date.now()}_${crypto.randomUUID().slice(0, 8)}`)
    const pages = join(stage, "pages")
    mkdirSync(pages, { recursive: true })
    const uploads: asset_upload[] = []
    const manifest: string[] = JSON.parse(readFileSync(join(out, ".jazu_output.json"), "utf8"))
    for (const name of manifest) {
            const source = output_file(out, name)
            const size = statSync(source).size
            if (size > limit) {
                if (!name.startsWith("assets/media/") && !name.startsWith("assets/wasm/")) throw new Error(`Oversized asset ${name} must be published under assets/media or assets/wasm`)
                uploads.push({ key: name, file: source, size, content_type: mime[name.split(".").pop()!] ?? "application/octet-stream" })
            } else {
                mkdirSync(resolve(pages, name, ".."), { recursive: true })
                cpSync(source, join(pages, name))
            }
    }
    const config = JSON.parse(readFileSync(join(root, "wrangler.jsonc"), "utf8"))
    const projects = [...new Set(result.model.objects.filter(node => node.tag === "project").map(node => node.attrs.id))]
    config.name = result.model.config.deploy.worker_name
    config.main = join(root, "src/node/worker.ts")
    config.vars = { ...config.vars, DOMAIN: new URL(result.model.config.base_url).hostname, PUBLIC_PROJECTS: JSON.stringify(projects),
        ...(result.model.config.personal_server ? { PERSONAL_ORIGIN: result.model.config.personal_server } : {}) }
    if (config.d1_databases) for (const binding of config.d1_databases) binding.migrations_dir = join(root, "migrations")
    const worker_config = join(stage, "wrangler.worker.json")
    const pages_config = join(stage, "wrangler.pages.json")
    writeFileSync(worker_config, JSON.stringify(config, null, 2))
    writeFileSync(pages_config, JSON.stringify({ name: result.model.config.deploy.pages_project, pages_build_output_dir: pages, compatibility_date: config.compatibility_date }, null, 2))
    writeFileSync(join(stage, "uploads.json"), JSON.stringify(uploads, null, 2))
    writeFileSync(join(root, ".cache/deploy/latest.json"), JSON.stringify({ pages_config, worker_config, uploads }, null, 2))
    return { pages_config, worker_config, uploads }
}

export function wrangler(root: string, args: string[]): void {
    const entry = join(root, "node_modules/wrangler/bin/wrangler.js")
    const result = spawnSync(process.execPath, [entry, ...args], { cwd: root, stdio: "inherit", env: { ...process.env, WRANGLER_SEND_METRICS: "false" } })
    if (result.status !== 0) throw new Error(`Wrangler failed (${result.status ?? result.error?.message})`)
}

export async function deploy(root: string, out: string, result: build_result, target: string, dry_run: boolean): Promise<void> {
    if (!["pages", "worker", "all"].includes(target)) throw new Error("target must be pages, worker or all")
    const stage = prepare_deploy(root, out, result)
    console.log(`Prepared Pages and Worker configurations; ${stage.uploads.length} large assets require R2. See .cache/deploy/latest.json`)
    if (dry_run) {
        wrangler(root, ["deploy", "--config", stage.worker_config, "--dry-run", "--outdir", join(root, ".cache/worker_bundle")])
        return
    }
    if (target !== "worker") {
        const config = JSON.parse(readFileSync(stage.worker_config, "utf8"))
        const bucket = config.r2_buckets?.find((item: { binding: string }) => item.binding === "ASSETS")?.bucket_name
        if (stage.uploads.length && !bucket) throw new Error("Configure the ASSETS R2 binding before deploying large media")
        for (const upload of stage.uploads) wrangler(root, ["r2", "object", "put", `${bucket}/${upload.key}`, "--file", upload.file, "--content-type", upload.content_type, "--remote"])
        wrangler(root, ["pages", "deploy", "--config", stage.pages_config])
    }
    if (target !== "pages") wrangler(root, ["deploy", "--config", stage.worker_config])
}
