/* Reviewed project metadata loader shared by infrastructure and the personal server. */
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parse_xml, type xml_node } from "./xml.ts"
import { validate_roots } from "./schema.ts"
import { new_diagnostics } from "../diag.ts"
import { project_declarations } from "./pipeline.ts"

function xml_files(path: string): string[] {
    if (!existsSync(path)) return []
    return readdirSync(path).sort().flatMap(name => {
        const file = join(path, name)
        const stat = lstatSync(file)
        if (stat.isSymbolicLink()) return []
        return stat.isDirectory() ? xml_files(file) : name.endsWith(".xml") ? [file] : []
    })
}

export function load_project_declarations(catalog_dir: string): ReturnType<typeof project_declarations> {
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
    return project_declarations(projects)
}
