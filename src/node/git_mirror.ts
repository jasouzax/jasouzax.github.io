/*
 * Static git mirror: turns a repository into the plain files git's "dumb HTTP" protocol needs, so that
 * `git clone https://{domain}/projects/{id}.git` is served by Cloudflare Pages and never touches this machine.
 *
 * Entities:
 *   refresh_mirror(config, id, pin)   rebuild `<state>/mirror/projects/{id}.git` if the published refs changed
 *   refresh_mirrors(config, pin)      all public projects; one failing mirror never blocks the others
 *
 * Scope:
 *   Works on a private staging copy (`<state>/mirror_src/{id}.git`), so the source repository is never repacked or
 *   modified. The staging copy is repacked into few packs (Pages allows 20,000 files and 25 MiB per file) and only an
 *   allow-list of files is published: HEAD, info/refs, objects/info/packs, objects/pack/*.pack|idx. Config, hooks,
 *   logs and private refs can never leak. Oversized packs containing indivisible historical blobs go to R2.
 *   Active project: only the deploy branch (pinned to the commit CI approved) and tags are public; collaborator
 *   branches stay private until an owner merges them. Archived projects publish all branches and tags.
 *   Private projects are never mirrored (clones go through git_http.ts with a token).
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { join } from "node:path"
import { is_active, is_public, repository_path } from "./server_config.ts"
import type { Server_Config } from "./server_config.ts"

export type Mirror_Result = { id: string, status: "updated" | "unchanged" | "skipped", reason?: string, files?: number, bytes?: number }

export function mirror_dir(config: Server_Config): string { return join(config.state_dir, "mirror") }

function git(cwd: string, args: string[]): string {
    try { return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true }) }
    catch (error: any) { throw new Error(`git ${args[0]} failed: ${String(error.stderr ?? error.message).trim().slice(0, 300)}`) }
}

function patterns(config: Server_Config, id: string): { refspecs: string[], head: string | null, listing: string[] } {
    if (!is_active(config, id)) return { refspecs: ["+refs/heads/*:refs/heads/*", "+refs/tags/*:refs/tags/*"], head: null, listing: ["refs/heads", "refs/tags"] }
    const branch = `refs/heads/${config.site.branch}`
    return { refspecs: [`+${branch}:${branch}`, "+refs/tags/*:refs/tags/*"], head: branch, listing: [branch, "refs/tags"] }
}

function published_files(stage: string): string[] {
    const packs = existsSync(join(stage, "objects/pack")) ? readdirSync(join(stage, "objects/pack")).filter(name => /^pack-[0-9a-f]+\.(pack|idx)$/.test(name)).map(name => `objects/pack/${name}`) : []
    return ["HEAD", "info/refs", "objects/info/packs", ...packs]
}

function source_head(source: string): string {
    try { return git(source, ["symbolic-ref", "-q", "HEAD"]).trim() } catch { return "" }
}

function state_file(config: Server_Config): string { return join(config.state_dir, "mirror_state.json") }

function read_state(config: Server_Config): Record<string, string> {
    try { return JSON.parse(readFileSync(state_file(config), "utf8")) } catch { return {} }
}

export function refresh_mirror(config: Server_Config, id: string, pin?: string): Mirror_Result {
    const source = repository_path(config, id)
    const target = join(mirror_dir(config), "projects", `${id}.git`)
    if (!is_public(config, id)) { rmSync(target, { recursive: true, force: true }); return { id, status: "skipped", reason: "private" } }
    if (!existsSync(join(source, "HEAD"))) return { id, status: "skipped", reason: "repository not found" }
    const { refspecs, head, listing } = patterns(config, id)
    const refs = git(source, ["for-each-ref", "--format=%(refname) %(objectname)", ...listing]).trim()
    if (!refs) return { id, status: "skipped", reason: "no commits to publish" }
    const pinned = is_active(config, id) ? pin : undefined
    const fingerprint = createHash("sha256").update(`${refs}\n${head ?? source_head(source)}\n${pinned ?? ""}`).digest("hex")
    const state = read_state(config)
    if (state[id] === fingerprint && existsSync(target)) return { id, status: "unchanged" }

    const stage = join(config.state_dir, "mirror_src", `${id}.git`)
    if (!existsSync(join(stage, "HEAD"))) {
        mkdirSync(stage, { recursive: true })
        git(stage, ["init", "--bare", "--quiet"])
        git(stage, ["config", "gc.auto", "0"])
    }
    git(stage, ["fetch", "--quiet", "--prune", "--no-tags", source, ...refspecs])
    const published_head = head ?? source_head(source)
    if (pinned) {
        git(stage, ["cat-file", "-e", `${pinned}^{commit}`])
        git(stage, ["update-ref", head!, pinned])
    }
    if (published_head) git(stage, ["symbolic-ref", "HEAD", published_head])
    git(stage, ["repack", "-a", "-d", "-q", "--max-pack-size=20m"])
    git(stage, ["update-server-info"])

    const files = published_files(stage)
    let bytes = 0
    for (const name of files) {
        const size = statSync(join(stage, name)).size
        // A single historical blob can exceed the pack target; publish.ts uploads oversized packs to R2.
        bytes += size
    }
    // Built outside the published tree and swapped in, so a failed copy never leaves a half-published mirror.
    const fresh = join(config.state_dir, "mirror_new", `${id}.git`)
    rmSync(fresh, { recursive: true, force: true })
    for (const name of files) {
        mkdirSync(join(fresh, name, ".."), { recursive: true })
        copyFileSync(join(stage, name), join(fresh, name))
    }
    rmSync(target, { recursive: true, force: true })
    mkdirSync(join(target, ".."), { recursive: true })
    renameSync(fresh, target)
    writeFileSync(state_file(config), JSON.stringify({ ...state, [id]: fingerprint }, null, 2))
    return { id, status: "updated", files: files.length, bytes }
}

export function refresh_mirrors(config: Server_Config, pin?: string): { results: Mirror_Result[], errors: string[] } {
    const results: Mirror_Result[] = []
    const errors: string[] = []
    const ids = new Set([config.site.project, ...Object.keys(config.projects)])
    const published = join(mirror_dir(config), "projects")
    // A mirror of a project that left the config must stop being published.
    if (existsSync(published)) for (const name of readdirSync(published)) if (!ids.has(name.replace(/\.git$/, ""))) rmSync(join(published, name), { recursive: true, force: true })
    for (const id of ids) {
        try { results.push(refresh_mirror(config, id, pin)) } catch (error) { errors.push(`${id}: ${error instanceof Error ? error.message : error}`) }
    }
    return { results, errors }
}
