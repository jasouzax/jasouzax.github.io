/* Apply shared reviewed declarations to private server configuration. */
import { join } from "node:path"
import type { Server_Config } from "../config/repositories.ts"
import { load_project_declarations } from "../../shared/content/catalog.ts"
export { load_project_declarations } from "../../shared/content/catalog.ts"

export function apply_project_catalog(config: Server_Config, catalog_dir = config.site.dir): void {
    const declarations = load_project_declarations(catalog_dir)
    config.catalog = declarations.size > 0
    for (const [id, declaration] of declarations) {
        const local = config.projects[id]
        const branch = declaration.pipeline?.branch ?? local?.branch ?? (id === config.site.project ? config.site.branch : "master")
        const upstream = declaration.remote ? { remote: declaration.remote, branch } : undefined
        config.projects[id] = {
            ...local, confidental: declaration.confidental, collaborators: declaration.collaborators, path: local?.path ?? join(config.repos_dir, `${id}.git`),
            visibility: declaration.private || local?.visibility === "private" ? "private" : "public",
            active: local?.active !== false, branch, pipeline: declaration.pipeline, pipelines: declaration.pipelines, upstream,
        }
        if (id === config.site.project) {
            config.site.branch = branch
            config.pipeline = declaration.pipeline
            config.pipelines = declaration.pipelines
            if (upstream) config.upstream = upstream
        }
    }
}
