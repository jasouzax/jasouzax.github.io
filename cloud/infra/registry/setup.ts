/* Build and provision the independent public OCI image registry, without modifying website routes or state. */
import { spawnSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { load_project_declarations } from "../../../shared/content/catalog.ts"
import { clone_origins } from "../../../shared/content/pipeline.ts"
import { load_config } from "../../../shared/config.ts"
import { build } from "esbuild"

const directory = dirname(fileURLToPath(import.meta.url)), root = resolve(directory, "../../..")
const [action = "plan", ...args] = process.argv.slice(2)
if (!["plan", "apply", "validate", "test", "output"].includes(action)) throw new Error("usage: setup.ts [plan|apply|validate|test|output]")
const bundle = join(root, ".cache/registry-infra/registry.js")
mkdirSync(dirname(bundle), { recursive: true })
await build({ entryPoints: [join(root, "cloud/repo/docker.ts")], outfile: bundle, bundle: true, format: "esm", platform: "browser", target: "es2022", minify: true })
const config = await load_config(root)
const declarations = load_project_declarations(root)
const bindings = [
    ...Object.entries({ SITE_DOMAIN: new URL(config.base_url).hostname, PAGES_ORIGIN: `https://${config.deploy.pages_project}.pages.dev`, PUBLIC_PROJECTS: JSON.stringify([...declarations].filter(([, project]) => !project.private && !project.confidental).map(([id]) => id)), PROJECT_CLONE_ORIGINS: JSON.stringify(clone_origins(declarations)), PERSONAL_ORIGIN: config.personal_server }).map(([name, text]) => ({ name, type: "plain_text", text })),
    ...["ORIGIN_HMAC_SECRET", "ACCESS_CLIENT_ID", "ACCESS_CLIENT_SECRET"].filter(name => process.env[name]).map(name => ({ name, type: "secret_text", text: process.env[name]! })),
]
const env = { TF_VAR_repository_bindings: JSON.stringify(bindings), ...process.env, TF_VAR_worker_bundle: bundle, TF_VAR_account_id: process.env.TF_VAR_account_id || process.env.CLOUDFLARE_ACCOUNT_ID, TF_VAR_zone_id: process.env.TF_VAR_zone_id || process.env.CLOUDFLARE_ZONE_ID }
for (const command of [["init", "-input=false"], [action, ...(action === "plan" ? ["-input=false"] : []), ...args]]) {
    const result = spawnSync(process.env.TERRAFORM_BIN ?? "terraform", command, { cwd: directory, env, stdio: "inherit", windowsHide: true })
    if (result.status !== 0) throw new Error(`Terraform ${command[0]} failed (${result.status ?? result.error?.message})`)
}
