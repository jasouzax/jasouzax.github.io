import { repo_sources, repository_remote, type Repo_Source } from "./repo.ts"
export { repo_sources, repository_remote, type Repo_Source } from "./repo.ts"
import { valid_subdomain_id } from "./ids.ts"
/*
 * Shared authoring contract for project repositories and pipelines.
 * Normalization and validation are pure so the content validator and personal server apply identical rules.
 * Command arguments are JSON arrays; only deploy steps can request named environment credentials.
 */
import type { xml_node } from "./xml.ts"

export type Pipeline_Phase = "ci" | "build" | "deploy"
export type Pipeline_Step = { name: string, phase: Pipeline_Phase, command: string, args: string[], timeout_ms: number, credentials: string[], continue?: boolean }
export type Project_Pipeline = { branch: string, hook?: string, steps: Pipeline_Step[] }
export type Project_Declaration = { remote?: string, pipeline?: Project_Pipeline, pipelines: Record<string, Project_Pipeline>, private: boolean, confidental?: boolean, collaborators?: string[], sources?: Repo_Source[] }
export const pipeline_variables = ["project", "branch", "commit", "mirror_dir", "publish_state"]

// Public HTTPS Git reads can use HTTPS remotes or GitHub's equivalent HTTPS URL for its SSH remotes.
export function clone_origins(declarations: Map<string, Project_Declaration>): Record<string, string> {
    const origins: Record<string, string> = Object.create(null)
    for (const [id, declaration] of declarations) {
        if (declaration.private || declaration.confidental || !declaration.remote) continue
        let remote = declaration.remote.replace(/^git@github\.com:/, "https://github.com/").replace(/^ssh:\/\/git@github\.com\//, "https://github.com/")
        let url: URL
        try { url = new URL(remote) } catch { continue }
        if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.port || url.pathname === "/") continue
        remote = url.href.replace(/\/+$/, "")
        origins[id] = remote.endsWith(".git") ? remote : `${remote}.git`
    }
    return origins
}

export function project_declarations(nodes: xml_node[]): Map<string, Project_Declaration> {
    const declarations = new Map<string, Project_Declaration>()
    for (const node of nodes.filter(node => node.tag === "project")) {
        const nodes = node.children.filter(child => child.tag === "pipeline")
        if (!node.attrs.repo && !nodes.length) continue
        const id = node.attrs.id
        if (!valid_subdomain_id(id)) throw new Error(`Invalid managed project id ${id}`)
        const pipelines: Record<string, Project_Pipeline> = Object.create(null)
        for (const node of nodes) {
            const pipeline = parse_pipeline(node)
            if (Object.hasOwn(pipelines, pipeline.branch)) throw new Error(`Duplicate pipeline branch ${pipeline.branch}`)
            pipelines[pipeline.branch] = pipeline
        }
        const declaration: Project_Declaration = { remote: node.attrs.repo ? repository_remote(node.attrs.repo) : undefined, pipeline: Object.values(pipelines)[0], pipelines, private: node.attrs.private === "true", confidental: node.attrs.confidental === "true", collaborators: (node.attrs.collaborators ?? "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean), sources: node.attrs.repo ? repo_sources(node.attrs.repo) : [] }
        const previous = declarations.get(id)
        if (previous && JSON.stringify(previous) !== JSON.stringify(declaration)) throw new Error(`Conflicting repo/pipeline declarations for project ${id}; translations must agree or declare server metadata only once`)
        declarations.set(id, declaration)
    }
    return declarations
}

export function valid_branch(branch: string): boolean {
    return /^[a-zA-Z0-9_][a-zA-Z0-9_./-]*$/.test(branch) && !branch.includes("..") && !branch.includes("//") && !branch.endsWith("/") && !branch.endsWith(".") && !branch.split("/").some(part => part.startsWith(".") || part.endsWith(".lock"))
}

export function parse_pipeline(node: xml_node): Project_Pipeline {
    const branch = node.attrs.branch ?? "master"
    const hook = node.attrs.hook
    if (hook !== undefined && !/^[a-z0-9][a-z0-9-]{0,63}$/.test(hook)) throw new Error("pipeline hook must be a lowercase safe URL segment")
    if (!valid_branch(branch)) throw new Error("pipeline branch must be a safe Git branch name")
    if (node.attrs.poll_seconds !== undefined) throw new Error("pipeline poll_seconds was removed; use repository post-receive or manual sync")
    const names = new Set<string>()
    let previous_phase = 0
    const phases = ["ci", "build", "deploy"]
    const flatten = (nodes: xml_node[], phase = "ci"): xml_node[] => nodes.flatMap(step => {
        const inherited = { ...step, attrs: { ...step.attrs, phase: step.attrs.phase ?? phase } }
        return [inherited, ...flatten(step.children, inherited.attrs.phase)]
    })
    if (node.children.some(child => !["step", "menu", "window", "action"].includes(child.tag))) throw new Error("pipeline may contain only <step>, <menu>, <window> and <action> elements")
    const steps = flatten(node.children.filter(child => child.tag === "step")).map(step => {
        if (step.tag !== "step") throw new Error("pipeline may contain only <step> elements")
        const name = step.attrs.name
        const phase = step.attrs.phase ?? "ci"
        const command = step.attrs.command ?? ""
        const timeout = Number(step.attrs.timeout_seconds ?? 600)
        if (!name || names.has(name)) throw new Error("pipeline step names must be nonempty and unique")
        names.add(name)
        const position = phases.indexOf(phase)
        if (position < previous_phase || position < 0) throw new Error("pipeline phases must be ordered ci, build, deploy")
        previous_phase = position
        if (command && (/[\x00-\x1f]/.test(command) || command.startsWith("-"))) throw new Error("pipeline step command must name an executable")
        let args: unknown
        try { args = JSON.parse(step.attrs.args ?? "[]") } catch { throw new Error("pipeline step args must be a JSON array of strings") }
        if (!Array.isArray(args) || args.some(arg => typeof arg !== "string" || arg.includes("\0"))) throw new Error("pipeline step args must be a JSON array of strings")
        if (!command && (args.length || step.attrs.args !== undefined || step.attrs.credentials)) throw new Error("pipeline args and credentials require command")
        for (const arg of args as string[]) for (const match of arg.matchAll(/\$\{([^}]+)\}/g)) if (!pipeline_variables.includes(match[1])) throw new Error(`unknown pipeline variable ${match[1]}`)
        if (!Number.isInteger(timeout) || timeout < 1 || timeout > 3600) throw new Error("pipeline timeout_seconds must be an integer between 1 and 3600")
        const credentials = (step.attrs.credentials ?? "").split(",").map(name => name.trim()).filter(Boolean)
        if (credentials.length && phase !== "deploy") throw new Error("only deploy steps may request credentials")
        if (credentials.some(name => !/^[A-Z][A-Z0-9_]*$/.test(name) || ["PATH", "HOME", "NODE_OPTIONS", "GIT_SSH_COMMAND", "LD_PRELOAD"].includes(name))) throw new Error("credentials must name secret environment variables, not runtime control variables")
        return { name, phase: phase as Pipeline_Phase, command, args: args as string[], timeout_ms: timeout * 1000, credentials, continue: step.attrs.continue === "true" }
    })
    return { branch, ...(hook ? { hook } : {}), steps }
}
