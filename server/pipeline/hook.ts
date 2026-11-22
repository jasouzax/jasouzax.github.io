/* Named hooks queue exact repository tips; HTTP callers never choose commands or commits. */
import { execFileSync } from "node:child_process"
import type { Server_Config } from "../config/repositories.ts"
import { is_active, project_branches, project_view, repository_path } from "../config/repositories.ts"
import { valid_subdomain_id } from "../../shared/content/ids.ts"
import { enqueue } from "./queue.ts"
import { api_error } from "../../shared/http.ts"

export function pipeline_hook(path: string, config: Server_Config): Response {
    const match = /^\/projects\/([a-z0-9-]+)\/([a-z0-9-]+)$/.exec(path)
    if (!match || !valid_subdomain_id(match[1]) || !is_active(config, match[1])) return api_error("not_found", "Unknown pipeline hook", 404)
    const [, id, hook] = match
    const selected = project_branches(config, id).map(branch => project_view(config, id, branch)).filter(view => view.pipeline?.hook === hook)
    if (!selected.length) return api_error("not_found", "Unknown pipeline hook", 404)
    // Resolve every ref before writing anything so a missing branch cannot partially trigger a hook.
    const jobs = selected.map(view => ({ kind: "hook" as const, project: id, ref: `refs/heads/${view.site.branch}`, commit: execFileSync("git", ["--git-dir", repository_path(config, id), "rev-parse", "--verify", `refs/heads/${view.site.branch}^{commit}`], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim() }))
    return Response.json({ jobs: jobs.map(job => { const queued = enqueue(config.state_dir, job); return { id: queued.id, ref: queued.ref, commit: queued.commit } }) }, { status: 202, headers: { "cache-control": "no-store" } })
}
