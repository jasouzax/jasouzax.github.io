/*
 * `node src/main.ts server <subcommand>`: the operator's tools for the personal server.
 *
 *   server init                       write a starter server.json (never overwrites)
 *   server repo init <id>             create the bare repository + hooks for a project
 *   server user add <name> [--role]   create a collaborator and print the token ONCE (owner | write | read)
 *   server user remove <name>
 *   server run [--branch <name>] [--commit <sha>]   queue CI/CD (default: primary branch tip)
 *   server status                     queue length and the latest runs
 *   server sync                       rewrite hooks and repository safety config
 *
 * Scope: edits server.json through update_server_file and talks to git/queue only. Tokens are shown once and only their
 * hash is stored. Never starts the node.
 */
import { existsSync, mkdirSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { dirname, join, resolve } from "node:path"
import { sync_repositories, sync_repository } from "./git_hooks.ts"
import { enqueue, pending } from "./queue.ts"
import { list_runs } from "./runner.ts"
import { hash_token, is_active, is_project_id, is_user_name, load_server_config, make_token, project_branch, project_branches, project_ids, project_view, repository_path, update_server_file } from "./server_config.ts"
import type { Role } from "./server_config.ts"
import { read_sync_state } from "./repo_sync.ts"

export function server_config_file(root: string, flags: Record<string, string | boolean>): string {
    return resolve(String(flags.config ?? process.env.JAZU_SERVER_CONFIG ?? join(root, "server.json")))
}

export function server_command(words: string[], flags: Record<string, string | boolean>, root: string): void {
    const file = server_config_file(root, flags)
    const [sub, action, name] = words
    if (sub === "init") {
        if (existsSync(file)) throw new Error(`${file} already exists`)
        update_server_file(file, raw => Object.assign(raw, { repos_dir: "repos", state_dir: ".server", site: { project: "jazu", dir: ".", branch: "master" }, projects: {}, collaborators: {} }))
        console.log(`wrote ${file}; next: server repo init jazu, server user add <you> --role owner`)
        return
    }
    const config = load_server_config(file)
    if (sub === "repo" && action === "init" && name) {
        if (!is_project_id(name)) throw new Error("project id must be lowercase letters, digits, - or _")
        const path = repository_path(config, name)
        if (existsSync(join(path, "HEAD"))) throw new Error(`${path} already exists`)
        mkdirSync(dirname(path), { recursive: true })
        execFileSync("git", ["init", "--bare", "--quiet", path], { stdio: "inherit" })
        execFileSync("git", ["-C", path, "symbolic-ref", "HEAD", `refs/heads/${project_branch(config, name)}`])
        sync_repository(config, name)
        console.log(`created ${path}${is_active(config, name) ? "" : " (archived: declare repo or pipeline in project XML to activate)"}`)
        return
    }
    if (sub === "user" && action === "add" && name) {
        const role = String(flags.role ?? "write") as Role
        if (!is_user_name(name) || !["owner", "write", "read"].includes(role)) throw new Error("usage: server user add <name> [--role owner|write|read]")
        if (config.collaborators[name]) throw new Error(`${name} already exists; remove it first to rotate the token`)
        const token = make_token()
        update_server_file(file, raw => { raw.collaborators = { ...raw.collaborators, [name]: { role, token_hash: hash_token(token) } } })
        console.log(`user ${name} (${role}). Token, shown once:\n  ${token}\nclone/push: git remote add origin https://${name}:<token>@<domain>/projects/${config.site.project}.git`)
        return
    }
    if (sub === "user" && action === "remove" && name) {
        update_server_file(file, raw => { delete raw.collaborators?.[name] })
        console.log(`removed ${name}`)
        return
    }
    if (sub === "run") {
        const id = String(flags.project ?? config.site.project)
        if (!is_active(config, id)) throw new Error(`${id} is not an active project`)
        const repository = repository_path(config, id)
        const branch = String(flags.branch ?? project_branch(config, id))
        project_view(config, id, branch)
        const commit = String(flags.commit ?? execFileSync("git", ["-C", repository, "rev-parse", `refs/heads/${branch}`], { encoding: "utf8" }).trim())
        const job = enqueue(config.state_dir, { kind: "manual", project: id, commit, ref: `refs/heads/${branch}`, pusher: "operator" })
        console.log(`queued ${job.id} for ${commit.slice(0, 8)}; the node picks it up within seconds`)
        return
    }
    if (sub === "status") {
        console.log(`queued: ${pending(config.state_dir).length}`)
        const ids = flags.project ? [String(flags.project)] : project_ids(config).filter(id => is_active(config, id))
        for (const id of ids) {
            for (const branch of project_branches(config, id).filter(branch => !flags.branch || branch === flags.branch)) {
                const view = project_view(config, id, branch)
                const sync = read_sync_state(view)
                console.log(`${id}:${branch}: ${sync?.status ?? "not checked"}${sync?.commit ? ` ${sync.commit.slice(0, 8)}` : ""}${sync?.message ? ` — ${sync.message}` : ""}`)
            }
            for (const run of list_runs(config.state_dir, id, 10).filter(run => !flags.branch || run.ref === `refs/heads/${flags.branch}`)) console.log(`${new Date(run.queued_at ?? 0).toISOString()}  ${run.ref ?? ""}  ${run.state}  ${run.kind}  ${run.commit?.slice(0, 8) ?? "-"}  ${run.deployed ? "deployed" : ""}  ${run.steps?.map(step => `${step.name}${step.ok ? "" : "(FAILED)"}`).join(", ")}`)
        }
        return
    }
    if (sub === "sync") {
        console.log(`hooks installed in: ${sync_repositories(config).join(", ") || "(no repositories yet)"}`)
        return
    }
    throw new Error("usage: server init | repo init <id> | user add <name> [--role] | user remove <name> | run [--project id] [--branch name] [--commit sha] | status [--project id] [--branch name] | sync")
}
