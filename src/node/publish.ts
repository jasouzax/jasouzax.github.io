/*
 * Pages staging and the content-only publish used by CD (`node src/main.ts publish`).
 *
 * Entities:
 *   stage_pages(...)          copies the built files (and an optional overlay such as the git mirror) into a fresh folder
 *   fingerprint_pages(...)    one hash over every staged file, so "did anything change?" is a string comparison
 *   wrangler_pages_deploy()   the only wrangler call: `wrangler pages deploy <dir>`
 *   publish_pages(...)        stage -> fingerprint -> skip when identical to the last successful deploy -> deploy
 *
 * Scope:
 *   No Terraform and no Worker bundling: infrastructure changes still go through `npm run deploy`. Files over the
 *   Pages limit are not uploaded here (they live in R2 from the last Terraform apply); they are reported and their
 *   names/sizes are part of the fingerprint. The state file is written only after wrangler succeeds, so a failed
 *   deploy is retried by the next run instead of being mistaken for "unchanged".
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { dirname, join, relative, resolve, sep } from "node:path"
import { output_file } from "../paths.ts"

export const pages_file_limit = 25 * 1024 * 1024
export type Asset_Upload = { key: string, file: string, size: number, content_type: string }
export type Staged_Pages = { stage: string, pages: string, uploads: Asset_Upload[] }
export type Publish_Options = { overlay_dir?: string, state_file?: string, dry_run?: boolean, force?: boolean, commit?: string, message?: string, branch?: string, limit?: number }
export type Publish_Result = { deployed: boolean, reason: "changed" | "unchanged" | "forced" | "dry_run", fingerprint: string, files: number, large_assets: string[] }

const mime: Record<string, string> = { mp4: "video/mp4", webm: "video/webm", png: "image/png", jpg: "image/jpeg", avif: "image/avif", wasm: "application/wasm", mp3: "audio/mpeg", woff2: "font/woff2", js: "text/javascript", json: "application/json", zip: "application/zip", whl: "application/octet-stream" }

function walk(dir: string, found: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) walk(path, found)
        else if (entry.isFile()) found.push(path)
    }
    return found
}

// A unique staging folder prevents removed files from surviving between preparations.
export function stage_pages(root: string, out: string, limit = pages_file_limit, overlay_dir?: string): Staged_Pages {
    const stage = join(root, ".cache", "deploy", `${Date.now()}_${randomUUID().slice(0, 8)}`)
    const pages = join(stage, "pages")
    mkdirSync(pages, { recursive: true })
    const uploads: Asset_Upload[] = []
    try { fill_stage(out, pages, limit, uploads, overlay_dir) } catch (error) { rmSync(stage, { recursive: true, force: true }); throw error }
    return { stage, pages, uploads }
}

function fill_stage(out: string, pages: string, limit: number, uploads: Asset_Upload[], overlay_dir?: string): void {
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
    if (overlay_dir && existsSync(overlay_dir)) {
        for (const file of walk(overlay_dir)) {
            const name = relative(overlay_dir, file).split(sep).join("/")
            const target = output_file(pages, name)
            if (existsSync(target)) throw new Error(`Overlay file ${name} collides with a generated page`)
            if (statSync(file).size > limit) throw new Error(`Overlay file ${name} is over the Pages file limit`)
            mkdirSync(dirname(target), { recursive: true })
            cpSync(file, target)
        }
    }
}

export function fingerprint_pages(pages: string, uploads: Asset_Upload[]): string {
    const hash = createHash("sha256")
    for (const file of walk(pages)) hash.update(`${relative(pages, file).split(sep).join("/")}\0${createHash("sha256").update(readFileSync(file)).digest("hex")}\n`)
    for (const upload of [...uploads].sort((a, b) => a.key.localeCompare(b.key))) hash.update(`large:${upload.key}\0${upload.size}\n`)
    return hash.digest("hex")
}

export function wrangler_pages_deploy(root: string, directory: string, project: string, extra: string[] = []): void {
    const entry = join(root, "node_modules/wrangler/bin/wrangler.js")
    if (!existsSync(entry)) throw new Error("wrangler is not installed; run npm ci")
    const result = spawnSync(process.execPath, [entry, "pages", "deploy", directory, "--project-name", project, ...extra], { cwd: root, stdio: "inherit", env: { ...process.env, WRANGLER_SEND_METRICS: "false" } })
    if (result.status !== 0) throw new Error(`wrangler pages deploy failed (${result.status ?? result.error?.message})`)
}

function last_fingerprint(state_file: string | undefined): string | null {
    try { return state_file ? JSON.parse(readFileSync(state_file, "utf8")).fingerprint ?? null : null } catch { return null }
}

export function publish_pages(root: string, out: string, project: string, options: Publish_Options = {}): Publish_Result {
    const staged = stage_pages(root, out, options.limit ?? pages_file_limit, options.overlay_dir)
    try {
        const fingerprint = fingerprint_pages(staged.pages, staged.uploads)
        const files = walk(staged.pages).length
        const large_assets = staged.uploads.map(upload => upload.key)
        const base = { fingerprint, files, large_assets }
        if (!options.force && last_fingerprint(options.state_file) === fingerprint) return { ...base, deployed: false, reason: "unchanged" }
        if (options.dry_run) return { ...base, deployed: false, reason: "dry_run" }
        if (!process.env.CLOUDFLARE_API_TOKEN) throw new Error("CLOUDFLARE_API_TOKEN is not set (shell or .env)")
        const extra = ["--branch", options.branch ?? "master"]
        if (options.commit) extra.push("--commit-hash", options.commit)
        if (options.message) extra.push("--commit-message", options.message.slice(0, 200))
        wrangler_pages_deploy(root, staged.pages, project, extra)
        if (options.state_file) {
            mkdirSync(dirname(options.state_file), { recursive: true })
            writeFileSync(options.state_file, JSON.stringify({ fingerprint, deployed_at: new Date().toISOString(), commit: options.commit ?? null }, null, 2))
        }
        return { ...base, deployed: true, reason: options.force ? "forced" : "changed" }
    } finally { rmSync(staged.stage, { recursive: true, force: true }) }
}
