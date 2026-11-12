import type { xml_node } from "./xml.ts"
import { walk_nodes, where_of } from "./xml.ts"
import type { diagnostics } from "./diag.ts"
import { report_error } from "./diag.ts"
import { plugin_hosts } from "./plugin_types.ts"
import { parse_pipeline, repository_remote } from "./pipeline_types.ts"

type rule = {
    attrs: string[]
    required: string[]
    children: string[]
    bools?: string[]
}

const page_attrs = [
    "path", "lang", "name", "info", "rank", "featured", "date", "icon", "skill", "image", "noindex",
    "menu", "short", "note", "role", "sub", "media", "poster", "alt", "stack", "tags", "feature_stack", "website", "paper", "event", "source",
    "keywords", "canonical", "robots", "lastmod", "cover", "print",
]

export const research_sections: Record<string, string> = {
    terminology: "Terminology", problem: "Problem", solution: "Solution", significance: "Significance",
    objectives: "Objectives", literature_review: "Literature Review", frameworks: "Frameworks",
    methodology: "Methodology", results: "Results",
}

export const rules: Record<string, rule> = {
    page: { attrs: page_attrs, required: ["path", "name"], children: ["hero", "expertise", "desk", "style"], bools: ["featured", "noindex", "menu"] },
    landing: { attrs: ["greet", "name", "family", "role", "info", "status", "tab", "icon"], required: [], children: ["action", "contact"] },
    action: { attrs: ["icon", "text", "link", "primary"], required: ["text", "link"], children: [], bools: ["primary"] },
    contact: { attrs: ["name", "info", "icon", "text", "link", "tab", "button", "act", "tz", "print"], required: [], children: ["contact", "action"] },
    expertise: { attrs: ["tab", "icon", "name", "info", "featured_chips"], required: [], children: ["skill", "stack"] },
    skill: { attrs: ["id", "name", "icon", "info", "stack", "group"], required: ["name"], children: ["stack"] },
    stack: { attrs: ["id", "name", "link", "tag", "icon"], required: ["name"], children: [] },
    event: { attrs: ["id", "name", "sub", "date", "icon", "type", "skill", "featured", "info", "note", "image", "resume", "resume_start", "resume_end"], required: ["name", "date"], children: [], bools: ["featured"] },
    error: { attrs: ["code", "name", "info", "home", "maybe"], required: ["name"], children: [] },
    desk: { attrs: ["icon", "name", "date", "info", "auto", "server"], required: [], children: ["menu", "window"], bools: ["auto", "server"] },
    menu: { attrs: ["name", "icon", "path"], required: [], children: ["entry", "foot", "map"] },
    entry: { attrs: ["id", "type", "name", "from", "data", "info", "icon", "date", "acts", "image", "open", "link"], required: [], children: ["entry"], bools: ["open"] },
    window: { attrs: ["icon", "type", "mode", "path", "full", "data", "save", "flow"], required: [], children: [], bools: ["full", "save", "flow"] },
    theme: { attrs: ["name", "label", "icon", "color", "js", "background", "preload"], required: [], children: ["font", "style"] },
    font: { attrs: ["name", "author", "size", "role", "src", "weight"], required: ["name"], children: ["palette", "sym"] },
    palette: { attrs: ["mode", "colors"], required: ["mode", "colors"], children: [] },
    sym: { attrs: ["char", "name", "path", "img", "width", "variant"], required: ["char"], children: ["layer"] },
    layer: { attrs: ["path", "color", "paint"], required: ["path"], children: [] },
    style: { attrs: ["src", "scope", "media"], required: [], children: [] },
    // Personal details for a printed resume in a fixed national form (format="rirekisho" is the Japanese 履歴書). Anything left out prints as an empty box.
    resume: {
        attrs: [
            "format", "photo", "name", "kana", "birth", "gender", "postal", "address", "address_kana", "phone", "mobile", "email",
            "contact_postal", "contact_address", "contact_kana", "contact_phone", "appeal", "motivation", "wishes",
            "commute_hours", "commute_minutes", "dependents", "spouse", "spouse_support",
        ],
        required: [], children: ["license"], bools: ["spouse", "spouse_support"],
    },
    license: { attrs: ["date", "text"], required: ["text"], children: [] },
}

Object.assign(rules, {
    hero: { attrs: ["status", "name", "tab", "tags", "info", "profile"], required: [], children: ["item", "action"] },
    item: { attrs: ["icon", "name", "text", "link", "print"], required: [], children: [] },
    project: { attrs: [...page_attrs.filter(attr => !["skill", "info"].includes(attr)), "id", "repo", "private", "lang"], required: ["id", "name", "date"], children: ["slide", "menu", "window", "action", "research", "pipeline"], bools: ["featured", "private"] },
    pipeline: { attrs: ["branch", "poll_seconds"], required: [], children: ["step"] },
    step: { attrs: ["name", "phase", "command", "args", "timeout_seconds", "credentials"], required: ["name", "command"], children: [] },
    research: { attrs: [], required: [], children: Object.keys(research_sections) },
    point: { attrs: ["name"], required: ["name"], children: ["point"] },
    slide: { attrs: ["media", "poster", "alt", "info", "description", "skill", "stack", "feature_stack", "hashtags", "tags", "featured", "private"], required: ["skill"], children: [], bools: ["featured", "private"] },
    event: { attrs: [...page_attrs, "id", "type", "lang", "resume", "resume_start", "resume_end"], required: ["id", "name", "date"], children: ["event"], bools: ["featured"] },
    blog: { attrs: ["id", "name", "date", "icon", "info", "lang"], required: ["id", "name"], children: ["menu", "window"] },
    print: { attrs: ["name", "lang", "size", "layout"], required: ["name"], children: ["style", "font"] },
    map: { attrs: ["layout"], required: [], children: ["node", "edge"] },
    node: { attrs: ["id", "name", "icon", "info", "link", "x", "y"], required: ["id"], children: ["node"] },
    edge: { attrs: ["from", "to", "text"], required: ["from", "to"], children: [] },
    foot: { attrs: [], required: [], children: ["action"] },
    plugin: { attrs: ["id", "name", "icon", "version", "mime", "path", "mode", "from", "to", "flow", "wasm", "sha256", "script", "options"], required: ["id", "version"], children: ["case"] },
    case: { attrs: ["file", "error", "view", "edit", "mime", "url", "host", "script", "child_file", "child_view", "child_edit", "child_mime", "child_url"], required: [], children: [], bools: ["file", "error", "view", "edit", "child_file", "child_view", "child_edit"] },
} satisfies Record<string, rule>)
for (const name of Object.keys(research_sections)) rules[name] = { attrs: [], required: [], children: name === "terminology" ? [] : ["point"] }
export const root_tags = ["page", "theme", "project", "event", "blog", "print", "plugin"]

function check_node(node: xml_node, diag: diagnostics): void {
    const rule = rules[node.tag]
    if (!rule) {
        report_error(diag, where_of(node), `unknown element <${node.tag}>`)
        return
    }
    if (node.tag === "project" && node.children.filter(child => child.tag === "research").length > 1)
        report_error(diag, where_of(node), "project may contain only one <research>")
    if (node.tag === "project") {
        const branches = node.children.filter(child => child.tag === "pipeline").map(child => child.attrs.branch ?? "master")
        if (new Set(branches).size !== branches.length) report_error(diag, where_of(node), "project pipeline branches must be unique")
        if (node.attrs.repo) try { repository_remote(node.attrs.repo) } catch (error) { report_error(diag, where_of(node), (error as Error).message) }
    }
    if (node.tag === "pipeline") try { parse_pipeline(node) } catch (error) { report_error(diag, where_of(node), (error as Error).message) }
    if (node.tag === "research") {
        const sections = new Set<string>()
        for (const child of node.children) {
            if (sections.has(child.tag)) report_error(diag, where_of(child), `duplicate research section <${child.tag}>`)
            sections.add(child.tag)
        }
    }
    if (node.tag === "page" && (!node.attrs.path?.startsWith("/") || /[\\?#%]/.test(node.attrs.path) || node.attrs.path.split("/").some(part => part === "." || part === ".."))) report_error(diag, where_of(node), "page path must be an absolute URL path without traversal, query or fragment")
    for (const [name, value] of Object.entries(node.attrs)) {
        if (["link", "href", "media", "profile", "image", "cover", "poster"].includes(name) && /^\s*(?:javascript|vbscript|data):/i.test(value)) report_error(diag, where_of(node), `unsafe URI in ${name}`)
    }
    for (const name of Object.keys(node.attrs)) {
        if (!rule.attrs.includes(name)) report_error(diag, where_of(node), `unknown attribute "${name}"`)
    }
    for (const name of rule.required) {
        if (!(name in node.attrs)) report_error(diag, where_of(node), `missing required attribute "${name}"`)
    }
    if (node.tag === "window" && node.attrs.mode && !["view", "edit"].includes(node.attrs.mode)) report_error(diag, where_of(node), "window mode must be view or edit")
    if (node.tag === "plugin" && node.attrs.wasm && !/^[a-f0-9]{64}$/i.test(node.attrs.sha256 ?? "")) report_error(diag, where_of(node), "WASM requires a SHA-256 integrity hash")
    if (node.tag === "case") {
        if (node.attrs.host && !(plugin_hosts as readonly string[]).includes(node.attrs.host)) report_error(diag, where_of(node), `unknown plugin host "${node.attrs.host}"`)
        if (!node.attrs.host && !node.attrs.script && !node.parent?.attrs.script) report_error(diag, where_of(node), "case requires a host or script")
    }
    for (const name of rule.bools ?? []) {
        const value = node.attrs[name]
        if (value !== undefined && value !== "true" && value !== "false") report_error(diag, where_of(node), `attribute "${name}" must be true or false`)
    }
    for (const child of node.children) {
        if (!rule.children.includes(child.tag) && rules[child.tag]) report_error(diag, where_of(child), `<${child.tag}> is not allowed inside <${node.tag}>`)
    }
}

export function validate_roots(roots: xml_node[], diag: diagnostics): void {
    for (const root of roots) {
        if (!root_tags.includes(root.tag)) report_error(diag, where_of(root), `root element must be one of ${root_tags.join(", ")}`)
        walk_nodes(root, node => check_node(node, diag))
    }
}

export function is_true(value: string | undefined, fallback: boolean = false): boolean {
    if (value === undefined) return fallback
    return value === "true"
}
