/*
 * Server configuration of the personal node (`server.json`, git-ignored).
 *
 * Entities:
 *   Server_Config     resolved, validated view of server.json (absolute paths, defaults applied)
 *   load_server_config(file)   read + validate; throws a readable error for every invalid field
 *   update_server_file(file, change)   read-modify-write of the raw JSON (CLI only; never the running node)
 *   repository_path / is_active / can   pure lookups used by the transport, hooks and runner
 *   make_token / hash_token / verify_token   collaborator git tokens (scrypt, constant-time compare)
 *
 * Scope:
 *   site.project identifies the engine; repo/pipeline XML declarations activate independent managed projects.
 *   Private server settings supply paths, visibility restrictions and explicit archive overrides.
 *   Contains token hashes only, never tokens. No network, no git, no process spawning.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto"
import type { Project_Pipeline } from "../pipeline_types.ts"
import { apply_project_catalog } from "./project_catalog.ts"

export type Role = "owner" | "write" | "read"
export type Action = "read" | "write"
export type Project_Entry = { visibility: "public" | "private", path: string, active?: boolean, dir?: string, branch?: string, checkout_branch?: string, pipeline?: Project_Pipeline, pipelines?: Record<string, Project_Pipeline>, upstream?: Upstream_Config }
export type Collaborator = { role: Role, token_hash: string }
export type Upstream_Config = { remote: string, branch: string, poll_seconds: number }
export type Server_Config = {
    file: string
    repos_dir: string
    state_dir: string
    site: { project: string, dir: string, branch: string, checkout_branch?: string }
    projects: Record<string, Project_Entry>
    collaborators: Record<string, Collaborator>
    upstream?: Upstream_Config
    pipeline?: Project_Pipeline
    pipelines?: Record<string, Project_Pipeline>
    shared_checkout?: boolean
    primary_branch?: string
    work_state_dir?: string
    root_config?: Server_Config
    catalog?: boolean
}

const id_pattern = /^[a-z0-9][a-z0-9_-]{0,63}$/
const user_pattern = /^[a-z0-9][a-z0-9_-]{0,31}$/
const branch_pattern = /^[a-zA-Z0-9_][a-zA-Z0-9_./-]*$/
const roles: Role[] = ["owner", "write", "read"]
export const zero_oid = "0".repeat(40)

function absolute(base: string, value: unknown, fallback: string): string {
    const text = value === undefined ? fallback : String(value)
    return isAbsolute(text) ? resolve(text) : resolve(base, text)
}

export function is_project_id(value: string): boolean { return id_pattern.test(value) }
export function is_user_name(value: string): boolean { return user_pattern.test(value) }

export function repository_path(config: Server_Config, id: string): string {
    return config.projects[id]?.path ?? join(config.repos_dir, `${id}.git`)
}

export function is_active(config: Server_Config, id: string): boolean { return config.projects[id]?.active ?? id === config.site.project }

export function project_branch(config: Server_Config, id: string): string { return config.projects[id]?.branch ?? (id === config.site.project ? config.site.branch : "master") }

export function project_ids(config: Server_Config): string[] { return [...new Set([config.site.project, ...Object.keys(config.projects)])] }

export function project_branches(config: Server_Config, id: string): string[] {
    const root = config.root_config ?? config
    return [...new Set([project_branch(root, id), ...Object.keys(root.projects[id]?.pipelines ?? (id === root.site.project ? root.pipelines : undefined) ?? {})])]
}

export function project_view(config: Server_Config, id: string, selected_branch?: string): Server_Config {
    const root = config.root_config ?? config
    if (!is_active(root, id)) throw new Error(`${id} is archived and has no active pipeline`)
    const entry = root.projects[id]
    const branch = project_branch(root, id)
    const base = id === root.site.project ? root : { ...root, root_config: root, state_dir: join(root.state_dir, "projects", id), site: { project: id, dir: entry.dir ?? join(root.state_dir, "work", id), branch, checkout_branch: entry.checkout_branch ?? branch }, pipeline: entry.pipeline, pipelines: entry.pipelines, upstream: entry.upstream }
    if (!selected_branch) return base
    const pipeline = base.pipelines && Object.hasOwn(base.pipelines, selected_branch) ? base.pipelines[selected_branch] : selected_branch === branch ? base.pipeline : undefined
    if (selected_branch !== branch && !pipeline) throw new Error(`No pipeline declared for ${id}:${selected_branch}`)
    const shared_checkout = project_branches(root, id).length > 1
    return { ...base, root_config: root, primary_branch: branch, shared_checkout, work_state_dir: base.state_dir,
        state_dir: selected_branch === branch ? base.state_dir : join(base.state_dir, "branches", encodeURIComponent(selected_branch)),
        site: { ...base.site, branch: selected_branch, checkout_branch: shared_checkout ? selected_branch : base.site.checkout_branch }, pipeline,
        upstream: base.upstream ? { ...base.upstream, branch: selected_branch, poll_seconds: pipeline?.poll_seconds ?? base.upstream.poll_seconds } : undefined }
}

export function queue_root(config: Server_Config): string { return (config.root_config ?? config).state_dir }

export function is_public(config: Server_Config, id: string): boolean { return (config.projects[id]?.visibility ?? "public") === "public" }

export function can(role: Role, action: Action): boolean {
    return action === "read" ? roles.includes(role) : role === "owner" || role === "write"
}

// Reads server.json; `legacy` is the older JAZU_REPOSITORIES_JSON map, whose entries are read-only archived public repositories.
export function load_server_config(file: string, legacy: Record<string, string> = {}, catalog_dir?: string): Server_Config {
    const path = resolve(file)
    if (!existsSync(path)) throw new Error(`Missing ${path}; copy server.example.json and edit it`)
    let raw: any
    try { raw = JSON.parse(readFileSync(path, "utf8")) } catch (error) { throw new Error(`${path} is not valid JSON: ${error instanceof Error ? error.message : error}`) }
    const base = dirname(path)
    const site = { project: "jazu", branch: "master", ...raw.site }
    if (!id_pattern.test(site.project)) throw new Error("site.project must be a lowercase project id")
    if (!branch_pattern.test(site.branch) || site.branch.includes("..")) throw new Error("site.branch is not a safe branch name")
    if (site.checkout_branch !== undefined && (!branch_pattern.test(site.checkout_branch) || site.checkout_branch.includes(".."))) throw new Error("site.checkout_branch is not a safe branch name")
    const config: Server_Config = {
        file: path,
        repos_dir: absolute(base, raw.repos_dir, "repos"),
        state_dir: absolute(base, raw.state_dir, ".server"),
        site: { project: site.project, branch: site.branch, dir: absolute(base, site.dir, "."), checkout_branch: site.checkout_branch ?? site.branch },
        projects: {},
        collaborators: {},
    }
    if (raw.upstream && raw.upstream.enabled !== false) {
        const remote = raw.upstream.remote
        const branch = raw.upstream.branch ?? site.branch
        const poll_seconds = raw.upstream.poll_seconds ?? 60
        if (typeof remote !== "string" || !remote || /[\x00-\x1f]/.test(remote) || (!isAbsolute(remote) && /\s/.test(remote)) || remote.startsWith("-")) throw new Error("upstream.remote must be a credential-free Git URL or absolute local path")
        if (!isAbsolute(remote) && !/^[a-zA-Z0-9_.-]+@[a-zA-Z0-9.-]+:[a-zA-Z0-9_./-]+$/.test(remote)) {
            let url: URL
            try { url = new URL(remote) } catch { throw new Error("upstream.remote must use HTTPS or SSH") }
            if (!["https:", "ssh:"].includes(url.protocol) || url.password || (url.protocol === "https:" && url.username)) throw new Error("upstream.remote must use HTTPS or SSH without embedded credentials")
        }
        if (typeof branch !== "string" || !branch_pattern.test(branch) || branch.includes("..")) throw new Error("upstream.branch is not a safe branch name")
        if (!Number.isInteger(poll_seconds) || poll_seconds < 10 || poll_seconds > 86400) throw new Error("upstream.poll_seconds must be an integer between 10 and 86400")
        config.upstream = { remote, branch, poll_seconds }
    }
    for (const [id, source] of Object.entries(legacy)) config.projects[id] = { visibility: "public", path: absolute(base, source, "") }
    for (const [id, entry] of Object.entries<any>(raw.projects ?? {})) {
        if (!id_pattern.test(id)) throw new Error(`projects: invalid id "${id}"`)
        const visibility = entry?.visibility ?? "public"
        if (visibility !== "public" && visibility !== "private") throw new Error(`projects.${id}.visibility must be public or private`)
        if (entry.active !== undefined && typeof entry.active !== "boolean") throw new Error(`projects.${id}.active must be boolean`)
        if (entry.branch !== undefined && (!branch_pattern.test(entry.branch) || entry.branch.includes(".."))) throw new Error(`projects.${id}.branch is not safe`)
        if (entry.checkout_branch !== undefined && (!branch_pattern.test(entry.checkout_branch) || entry.checkout_branch.includes(".."))) throw new Error(`projects.${id}.checkout_branch is not safe`)
        config.projects[id] = { visibility, path: entry?.path ? absolute(base, entry.path, "") : join(config.repos_dir, `${id}.git`), active: entry.active, dir: entry.dir ? absolute(base, entry.dir, "") : undefined, branch: entry.branch, checkout_branch: entry.checkout_branch }
    }
    for (const [name, entry] of Object.entries<any>(raw.collaborators ?? {})) {
        if (!user_pattern.test(name)) throw new Error(`collaborators: invalid name "${name}"`)
        if (!roles.includes(entry?.role)) throw new Error(`collaborators.${name}.role must be one of ${roles.join(", ")}`)
        if (!/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{64}$/.test(String(entry?.token_hash))) throw new Error(`collaborators.${name}.token_hash is not a scrypt hash (use "server user add")`)
        config.collaborators[name] = { role: entry.role, token_hash: entry.token_hash }
    }
    apply_project_catalog(config, catalog_dir)
    if (site.checkout_branch === undefined) config.site.checkout_branch = config.site.branch
    return config
}

// The CLI edits the raw JSON so derived absolute paths never leak into the file; the write is atomic.
export function update_server_file(file: string, change: (raw: any) => void): void {
    const path = resolve(file)
    const raw = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {}
    change(raw)
    const temp = `${path}.${process.pid}.tmp`
    writeFileSync(temp, JSON.stringify(raw, null, 4) + "\n", { mode: 0o600 })
    renameSync(temp, path)
}

export function make_token(): string { return `jzt_${randomBytes(32).toString("base64url")}` }

function scrypt_hex(token: string, salt: string): string { return scryptSync(token, Buffer.from(salt, "hex"), 32).toString("hex") }

export function hash_token(token: string): string {
    const salt = randomBytes(16).toString("hex")
    return `scrypt$${salt}$${scrypt_hex(token, salt)}`
}

const dummy_hash = hash_token("jzt_unused")

// An unknown user is verified against a dummy hash so response time does not reveal which names exist.
export function verify_token(config: Server_Config, name: string, token: string): Role | null {
    const entry = Object.hasOwn(config.collaborators, name) ? config.collaborators[name] : undefined
    const [, salt, expected] = (entry?.token_hash ?? dummy_hash).split("$")
    const actual = Buffer.from(scrypt_hex(token, salt), "hex")
    const equal = timingSafeEqual(actual, Buffer.from(expected, "hex"))
    return entry && equal ? entry.role : null
}
