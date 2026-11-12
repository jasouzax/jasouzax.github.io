/*
 * Load reviewed project repository/pipeline declarations from the engine checkout's content XML.
 * XML controls portable behavior; server.json supplies private bare/working paths and can archive a project.
 * Conflicting translated declarations fail closed. Catalogs are reloaded only by the idle sequential runner.
 */
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parse_xml } from "../xml.ts"
import type { xml_node } from "../xml.ts"
import { validate_roots } from "../schema.ts"
import { new_diagnostics } from "../diag.ts"
import { project_declarations } from "../pipeline_types.ts"
import type { Server_Config } from "./server_config.ts"

function xml_files(path: string): string[] {
    if (!existsSync(path)) return []
    return readdirSync(path).sort().flatMap(name => {
        const file = join(path, name)
        const stat = lstatSync(file)
        if (stat.isSymbolicLink()) return []
        return stat.isDirectory() ? xml_files(file) : name.endsWith(".xml") ? [file] : []
    })
}

export function apply_project_catalog(config: Server_Config, catalog_dir = config.site.dir): void {
    const projects: xml_node[] = []
    for (const file of xml_files(join(catalog_dir, "content"))) {
        const source = readFileSync(file, "utf8")
        if (!/<project\b/.test(source)) continue
        const roots = parse_xml(source, file)
        const diag = new_diagnostics()
        validate_roots(roots, diag)
        if (diag.errors.length) throw new Error(diag.errors.join("\n"))
        projects.push(...roots.filter(node => node.tag === "project"))
    }
    const declarations = project_declarations(projects)
    config.catalog = declarations.size > 0
    for (const [id, declaration] of declarations) {
        const local = config.projects[id]
        const branch = declaration.pipeline?.branch ?? local?.branch ?? (id === config.site.project ? config.site.branch : "master")
        const upstream = declaration.remote ? { remote: declaration.remote, branch, poll_seconds: declaration.pipeline?.poll_seconds ?? 60 } : undefined
        config.projects[id] = {
            ...local, path: local?.path ?? join(config.repos_dir, `${id}.git`),
            visibility: declaration.private || local?.visibility === "private" ? "private" : "public",
            active: local?.active !== false, branch, pipeline: declaration.pipeline, upstream,
        }
        if (id === config.site.project) {
            config.site.branch = branch
            config.pipeline = declaration.pipeline
            if (upstream) config.upstream = upstream
        }
    }
}
