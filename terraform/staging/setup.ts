/*
 * Standalone staging infrastructure entry. Bundles the Worker and invokes Terraform in this directory.
 * Existing .env inputs map to TF_VAR_* in child memory; secrets never enter generated var-files or arguments.
 * Production Terraform state is deliberately not loaded. Terraform retains its normal plan/apply review.
 */
import { spawnSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { build } from "esbuild"
import { clone_origins } from "../../src/pipeline_types.ts"
import { load_project_declarations } from "../../src/node/project_catalog.ts"

const directory = dirname(fileURLToPath(import.meta.url))
const root = resolve(directory, "../..")

export function staging_environment(source: NodeJS.ProcessEnv, bundle: string): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...source, TF_VAR_worker_bundle: bundle }
    const aliases: Record<string, string[]> = {
        account_id: ["CLOUDFLARE_ACCOUNT_ID"], zone_id: ["CLOUDFLARE_ZONE_ID"],
        origin_hmac_secret: ["ORIGIN_HMAC_SECRET", "HMAC_SECRET"],
        access_client_id: ["ACCESS_CLIENT_ID"], access_client_secret: ["ACCESS_CLIENT_SECRET"],
        personal_origin: ["PERSONAL_ORIGIN"],
        work_owner_token: ["WORK_OWNER_TOKEN"], work_owner_email: ["WORK_OWNER_EMAIL"],
        google_client_id: ["GOOGLE_CLIENT_ID"], google_client_secret: ["GOOGLE_CLIENT_SECRET"], google_admin_email: ["GOOGLE_ADMIN_EMAIL"],
    }
    for (const [name, alternatives] of Object.entries(aliases)) {
        const key = `TF_VAR_${name}`
        if (!env[key]) for (const alias of alternatives) if (source[alias]) { env[key] = source[alias]; break }
    }
    return env
}

export async function prepare_staging(): Promise<string> {
    const bundle = join(root, ".cache/staging-infra/worker.js")
    mkdirSync(dirname(bundle), { recursive: true })
    await build({ entryPoints: [join(root, "src/node/worker.ts")], outfile: bundle, bundle: true, format: "esm", platform: "browser", target: "es2022", minify: true })
    return bundle
}

async function main(): Promise<void> {
    const [action = "plan", ...args] = process.argv.slice(2)
    if (!["prepare", "init", "validate", "test", "plan", "apply", "output", "import"].includes(action)) throw new Error("usage: setup.ts [prepare|init|validate|test|plan|apply|output|import] [terraform arguments]")
    const bundle = await prepare_staging()
    if (action === "prepare") return console.log("Staging Worker bundled; infrastructure unchanged.")
    const env = staging_environment(process.env, bundle)
    env.TF_VAR_project_clone_origins = JSON.stringify(clone_origins(load_project_declarations(root)))
    const run = (args: string[]) => {
        const result = spawnSync(env.TERRAFORM_BIN ?? "terraform", args, { cwd: directory, env, stdio: "inherit", windowsHide: true })
        if (result.error) throw new Error(`Cannot run Terraform: ${result.error.message}. Install Terraform >=1.7 or set TERRAFORM_BIN.`)
        if (result.status !== 0) throw new Error(`Terraform ${args[0]} failed (${result.status ?? result.signal})`)
    }
    run(["init", "-input=false", ...(action === "init" ? args : [])])
    if (action !== "init") run([action, ...(action === "plan" ? ["-input=false"] : []), ...args])
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(error => { console.error(error.message); process.exitCode = 1 })
