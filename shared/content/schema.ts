import { valid_subdomain_id } from "./ids.ts"
import type { xml_node } from "./xml.ts"
import { walk_nodes, where_of } from "./xml.ts"
import type { diagnostics } from "../diag.ts"
import { report_error } from "../diag.ts"
import { plugin_hosts } from "./plugin.ts"
import { parse_pipeline, repository_remote } from "./pipeline.ts"

import type { Tag_Rule } from "./rule.ts"
import { action_rule } from "./tags/action.ts"
import { blog_rule } from "./tags/blog.ts"
import { case_rule } from "./tags/case.ts"
import { desk_rule } from "./tags/desk.ts"
import { edge_rule } from "./tags/edge.ts"
import { entry_rule } from "./tags/entry.ts"
import { event_rule } from "./tags/event.ts"
import { expertise_rule } from "./tags/expertise.ts"
import { font_rule } from "./tags/font.ts"
import { foot_rule } from "./tags/foot.ts"
import { frameworks_rule } from "./tags/frameworks.ts"
import { hero_rule } from "./tags/hero.ts"
import { item_rule } from "./tags/item.ts"
import { layer_rule } from "./tags/layer.ts"
import { map_rule } from "./tags/map.ts"
import { menu_rule } from "./tags/menu.ts"
import { methodology_rule } from "./tags/methodology.ts"
import { node_rule } from "./tags/node.ts"
import { objectives_rule } from "./tags/objectives.ts"
import { page_rule } from "./tags/page.ts"
import { palette_rule } from "./tags/palette.ts"
import { pipeline_rule } from "./tags/pipeline.ts"
import { plugin_rule } from "./tags/plugin.ts"
import { point_rule } from "./tags/point.ts"
import { print_rule } from "./tags/print.ts"
import { problem_rule } from "./tags/problem.ts"
import { project_rule } from "./tags/project.ts"
import { research_rule } from "./tags/research.ts"
import { results_rule } from "./tags/results.ts"
import { significance_rule } from "./tags/significance.ts"
import { similar_rule } from "./tags/similar.ts"
import { skill_rule } from "./tags/skill.ts"
import { slide_rule } from "./tags/slide.ts"
import { solution_rule } from "./tags/solution.ts"
import { stack_rule } from "./tags/stack.ts"
import { step_rule } from "./tags/step.ts"
import { style_rule } from "./tags/style.ts"
import { sym_rule } from "./tags/sym.ts"
import { terminology_rule } from "./tags/terminology.ts"
import { theme_rule } from "./tags/theme.ts"
import { window_rule } from "./tags/window.ts"

export const research_sections: Record<string, string> = {
    "terminology": "Terminology",
    "problem": "Problem",
    "solution": "Solution",
    "significance": "Significance",
    "objectives": "Objectives",
    "similar": "Similar",
    "frameworks": "Frameworks",
    "methodology": "Methodology",
    "results": "Results"
}

export const rules: Record<string, Tag_Rule> = {
    action: action_rule,
    blog: blog_rule,
    case: case_rule,
    desk: desk_rule,
    edge: edge_rule,
    entry: entry_rule,
    event: event_rule,
    expertise: expertise_rule,
    font: font_rule,
    foot: foot_rule,
    frameworks: frameworks_rule,
    hero: hero_rule,
    item: item_rule,
    layer: layer_rule,
    map: map_rule,
    menu: menu_rule,
    methodology: methodology_rule,
    node: node_rule,
    objectives: objectives_rule,
    page: page_rule,
    palette: palette_rule,
    pipeline: pipeline_rule,
    plugin: plugin_rule,
    point: point_rule,
    print: print_rule,
    problem: problem_rule,
    project: project_rule,
    research: research_rule,
    results: results_rule,
    significance: significance_rule,
    similar: similar_rule,
    skill: skill_rule,
    slide: slide_rule,
    solution: solution_rule,
    stack: stack_rule,
    step: step_rule,
    style: style_rule,
    sym: sym_rule,
    terminology: terminology_rule,
    theme: theme_rule,
    window: window_rule,
}
export const root_tags = ["page","theme","project","event","blog","print","plugin"]

function check_node(node: xml_node, diag: diagnostics): void {
    const rule = rules[node.tag]
    if (!rule) {
        report_error(diag, where_of(node), `unknown element <${node.tag}>`)
        return
    }
    if (node.tag === "project" && node.children.filter(child => child.tag === "research").length > 1)
        report_error(diag, where_of(node), "project may contain only one <research>")
    if (node.tag === "project") {
        if (node.attrs.collaborators && node.attrs.collaborators.split(",").some(email => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))) report_error(diag, where_of(node), "project collaborators must be email addresses")
        if (!valid_subdomain_id(node.attrs.id)) report_error(diag, where_of(node), "project id must be an unreserved DNS label (1 to 63 lowercase characters, no underscores, xn--, -demo or -server)")
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
    if (node.tag === "window" && node.attrs.view === "true" && node.attrs.edit === "true") report_error(diag, where_of(node), "window view and edit are mutually exclusive")
    if (node.tag === "window" && node.attrs.split !== undefined && !/^[1-9][0-9]*$/.test(node.attrs.split)) report_error(diag, where_of(node), "window split must name a positive parent window ID")
    if (node.tag === "window" && node.attrs.split && Number(node.attrs.split) >= (node.parent?.children.filter(child => child.tag === "window").indexOf(node) ?? -1) + 1) report_error(diag, where_of(node), "window split must refer to an earlier sibling window (IDs start at 1)")
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
