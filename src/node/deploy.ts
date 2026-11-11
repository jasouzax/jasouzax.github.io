import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { build as esbuild_build } from "esbuild"
import type { build_result } from "../build.ts"
import { stage_pages, wrangler_pages_deploy } from "./publish.ts"
import type { Asset_Upload } from "./publish.ts"

export type asset_upload = Asset_Upload

// Staging (including the optional overlay such as the static git mirror) lives in publish.ts and is shared with CD.
export async function prepare_deploy(root: string, out: string, result: build_result, limit = 25 * 1024 * 1024, overlay_dir?: string): Promise<{ pages_dir: string, worker_bundle: string, var_file: string, uploads: asset_upload[] }> {
    const { stage, pages, uploads } = stage_pages(root, out, limit, overlay_dir)
    // Terraform uploads a single ES module, so bundle the Worker (and its local imports) here.
    const worker_bundle = join(stage, "worker.js")
    const worker_entry = existsSync(join(root, "src/node/worker.ts")) ? join(root, "src/node/worker.ts") : resolve("src/node/worker.ts")
    await esbuild_build({ entryPoints: [worker_entry], outfile: worker_bundle, bundle: true, format: "esm", platform: "neutral", target: "es2022", minify: false, logLevel: "silent" })
    const projects = [...new Set(result.model.objects.filter(node => node.tag === "project").map(node => node.attrs.id))]
    const var_file = join(stage, "deploy.auto.tfvars.json")
    writeFileSync(var_file, JSON.stringify({
        worker_name: result.model.config.deploy.worker_name,
        pages_project: result.model.config.deploy.pages_project,
        domain: new URL(result.model.config.base_url).hostname,
        public_projects: JSON.stringify(projects),
        personal_origin: result.model.config.personal_server || null,
        worker_bundle,
        large_assets: uploads.map(upload => ({ key: upload.key, file: upload.file, content_type: upload.content_type })),
    }, null, 2))
    writeFileSync(join(stage, "uploads.json"), JSON.stringify(uploads, null, 2))
    mkdirSync(join(root, ".cache/deploy"), { recursive: true })
    writeFileSync(join(root, ".cache/deploy/latest.json"), JSON.stringify({ pages_dir: pages, worker_bundle, var_file, uploads }, null, 2))
    return { pages_dir: pages, worker_bundle, var_file, uploads }
}

// Loads <root>/.env (variables already set in the shell win) and maps the personal-node secrets to Terraform
// variables, so each value is written once. Anything else prefixed TF_VAR_ is read by Terraform directly.
export function load_env(root: string): void {
    const file = join(root, ".env")
    if (existsSync(file)) process.loadEnvFile(file)
    for (const [name, variable] of [["ORIGIN_HMAC_SECRET", "TF_VAR_origin_hmac_secret"], ["ACCESS_CLIENT_ID", "TF_VAR_access_client_id"], ["ACCESS_CLIENT_SECRET", "TF_VAR_access_client_secret"]]) {
        if (process.env[name] && !process.env[variable]) process.env[variable] = process.env[name]
    }
}

function run(root: string, command: string, args: string[], env: NodeJS.ProcessEnv = {}): void {
    const result = spawnSync(command, args, { cwd: root, stdio: "inherit", env: { ...process.env, ...env } })
    if (result.status !== 0) throw new Error(`${command} ${args[0] ?? ""} failed (${result.status ?? result.error?.message})`)
}

function terraform(root: string, args: string[]): void {
    run(root, "terraform", [`-chdir=${join(root, "terraform")}`, ...args])
}

// Terraform resources each target covers (dependencies such as the R2 bucket come along automatically).
const targets: Record<string, string[]> = {
    pages: ["cloudflare_pages_project.site", "aws_s3_object.large_assets"],
    worker: ["cloudflare_workers_script.router", "cloudflare_workers_script_subdomain.router", "cloudflare_workers_route.router", "terraform_data.d1_migrations"],
}

export async function deploy(root: string, out: string, result: build_result, target: string, dry_run: boolean): Promise<void> {
    if (!["pages", "worker", "all"].includes(target)) throw new Error("target must be pages, worker or all")
    load_env(root)
    const stage = await prepare_deploy(root, out, result)
    console.log(`Prepared Pages files, Worker bundle and Terraform variables; ${stage.uploads.length} large assets go to R2. See .cache/deploy/latest.json`)
    if (dry_run) {
        console.log(`Dry run: nothing applied. To preview the infrastructure changes run:\n  terraform -chdir=terraform plan -var-file=${stage.var_file}`)
        return
    }
    if (!process.env.CLOUDFLARE_API_TOKEN) throw new Error("CLOUDFLARE_API_TOKEN is not set (shell or .env)")
    const flags = target === "all" ? [] : targets[target].map(item => `-target=${item}`)
    terraform(root, ["init", "-input=false"])
    terraform(root, ["apply", "-input=false", `-var-file=${stage.var_file}`, ...flags])
    if (target !== "worker") {
        // Terraform has no resource for Pages direct-upload deployments, so this is the one remaining wrangler call.
        wrangler_pages_deploy(root, stage.pages_dir, result.model.config.deploy.pages_project, ["--branch", "master"])
    }
}
