import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { site_model, page } from "../model.ts"
import { pages_in, order_pages, find_page } from "../model.ts"
import type { xml_node } from "../xml.ts"
import { child_nodes } from "../xml.ts"
import { page_description, canonical_url, indexable, site_summary, link_target } from "./seo_common.tsx"

const home_prefix = "file:///home/jason/"

function title_case(text: string): string {
    return text.replace(/[-_]+/g, " ").replace(/\b[a-z]/g, (char) => char.toUpperCase())
}

function one_line(text: string | undefined): string {
    return (text ?? "").replace(/\s+/g, " ").trim()
}

function language_name(lang: string): string {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(lang) ?? lang
}

// ---------- llms.txt ----------

function section_key(page: page): string {
    return page.path === "/" ? "" : page.path.split("/")[1]
}

function section_title(model: site_model, key: string, lang: string): string {
    if (key === "") return "Main"
    return find_page(model, `/${key}`, lang)?.name ?? title_case(key)
}

function entry_line(model: site_model, page: page): string {
    const info = one_line(page_description(model, page))
    return `- [${page.name}](${canonical_url(model, page)})${info ? `: ${info}` : ""}`
}

export function llms_txt(model: site_model): string {
    const lang = model.config.default_language
    const pages = pages_in(model, lang).filter((page) => indexable(model, page))
    const out: string[] = [`# ${model.config.site_name}`, ""]
    const summary = one_line(site_summary(model))
    if (summary) out.push(`> ${summary}`, "")
    const owner = model.config.owner
    if (owner.name)
        out.push(
            `Maintained by ${owner.name}${owner.location ? `, ${owner.location}` : ""}.${owner.email ? ` Contact: ${owner.email}.` : ""}`,
            ""
        )
    const groups = new Map<string, page[]>()
    for (const page of pages) groups.set(section_key(page), [...(groups.get(section_key(page)) ?? []), page])
    const keys = [...groups.keys()].sort((a, b) => {
        if (a === "") return -1
        if (b === "") return 1
        const rank = (key: string): number => find_page(model, `/${key}`, lang)?.rank ?? -1
        return rank(b) - rank(a) || a.localeCompare(b)
    })
    for (const key of keys) {
        const members = groups.get(key)!
        const head = members.filter((page) => page.path === `/${key}` || page.path === "/")
        const rest = order_pages(members.filter((page) => !head.includes(page)))
        out.push(
            `## ${section_title(model, key, lang)}`,
            "",
            ...[...head, ...rest].map((page) => entry_line(model, page)),
            ""
        )
    }
    for (const other of Object.keys(model.config.languages).filter((item) => item !== lang)) {
        const translated = pages_in(model, other).filter((page) => indexable(model, page))
        if (translated.length)
            out.push(
                `## ${language_name(other)} (${other})`,
                "",
                ...order_pages(translated).map((page) => entry_line(model, page)),
                ""
            )
    }
    out.push(
        "## Optional",
        "",
        `- [Sitemap](${model.config.base_url}/sitemap.xml): every indexable page, with language alternates`
    )
    if (model.config.seo.llms.full)
        out.push(
            `- [Full text](${model.config.base_url}/llms-full.txt): the content of every page above in one file`
        )
    out.push("")
    return out.join("\n")
}

// ---------- llms-full.txt ----------

type names = { skills: Map<string, string>; stacks: Map<string, string> }

function collect_names(model: site_model, lang: string): names {
    const skills = new Map<string, string>()
    const stacks = new Map<string, string>()
    for (const page of pages_in(model, lang)) {
        for (const expertise of child_nodes(page.node, "expertise")) {
            for (const skill of child_nodes(expertise, "skill"))
                if (skill.attrs.id) skills.set(skill.attrs.id, skill.attrs.name)
            for (const stack of child_nodes(expertise, "stack"))
                if (stack.attrs.id) stacks.set(stack.attrs.id, stack.attrs.name)
            for (const event of child_nodes(expertise, "event"))
                if (event.attrs.id) skills.set(event.attrs.id, event.attrs.name)
        }
    }
    return { skills, stacks }
}

function resolve_list(value: string | undefined, table: Map<string, string>): string {
    return (value ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => table.get(item) ?? item)
        .join(", ")
}

function contact_lines(model: site_model, lang: string, node: xml_node): string[] {
    const lines: string[] = []
    for (const contact of child_nodes(node, "contact")) {
        const label = contact.attrs.name ?? ""
        const text = contact.attrs.text ?? ""
        const link =
            contact.attrs.link && !contact.attrs.link.startsWith("#")
                ? ` <${link_target(model, lang, contact.attrs.link)}>`
                : ""
        if (label || text) lines.push(`- ${[label, text].filter(Boolean).join(": ")}${link}`)
        lines.push(...contact_lines(model, lang, contact))
    }
    return lines
}

function read_home_file(model: site_model, path: string): string | null {
    if (!path.startsWith(home_prefix) || !/\.(md|markdown|txt)$/i.test(path)) return null
    const file = join(model.content_dir, "home_jason", path.slice(home_prefix.length))
    return existsSync(file) ? readFileSync(file, "utf8").trim() : null
}

function node_lines(model: site_model, page: page, node: xml_node, names: names): string[] {
    const lang = page.lang
    const out: string[] = []
    if (node.tag === "landing") {
        const who = one_line([node.attrs.greet, node.attrs.name, node.attrs.family].filter(Boolean).join(" "))
        for (const line of [who, node.attrs.role, node.attrs.info, node.attrs.status])
            if (line) out.push(one_line(line), "")
        const contacts = contact_lines(model, lang, node)
        if (contacts.length) out.push(...contacts, "")
    }
    if (node.tag === "expertise") {
        out.push(`### ${node.attrs.name ?? "Expertise"}`, "")
        if (node.attrs.info) out.push(one_line(node.attrs.info), "")
        const groups = new Map<string, string[]>()
        for (const skill of child_nodes(node, "skill"))
            groups.set(skill.attrs.group ?? "", [
                ...(groups.get(skill.attrs.group ?? "") ?? []),
                skill.attrs.name
            ])
        for (const [group, list] of groups) out.push(`- ${group ? `${group}: ` : ""}${list.join(", ")}`)
        if (groups.size) out.push("")
        for (const event of child_nodes(node, "event")) {
            const head = `${event.attrs.name}${event.attrs.sub ? `, ${event.attrs.sub}` : ""} (${event.attrs.date})`
            out.push(`- ${head}${event.attrs.info ? `: ${one_line(event.attrs.info)}` : ""}`)
        }
        const stacks = child_nodes(node, "stack")
        if (stacks.length) out.push("", `Tools: ${stacks.map((stack) => stack.attrs.name).join(", ")}`)
        out.push("")
    }
    if (node.tag === "contact") {
        out.push(`### ${node.attrs.name ?? "Contact"}`, "")
        if (node.attrs.info) out.push(one_line(node.attrs.info), "")
        const contacts = contact_lines(model, lang, node)
        if (contacts.length) out.push(...contacts, "")
    }
    if (node.tag === "error" && node.attrs.info) out.push(one_line(node.attrs.info), "")
    if (node.tag === "desk") {
        if (node.attrs.info) out.push(one_line(node.attrs.info), "")
        for (const entry of node.children.flatMap(function flat(item: xml_node): xml_node[] {
            return [item, ...item.children.flatMap(flat)]
        })) {
            if (entry.tag === "entry" && entry.attrs.data && entry.attrs.name)
                out.push(
                    `- ${entry.attrs.name}${entry.attrs.type ? ` (${entry.attrs.type})` : ""}: ${one_line(entry.attrs.data)}`
                )
        }
        for (const window of child_nodes(node, "window")) {
            const text = read_home_file(model, window.attrs.path ?? "")
            if (text) out.push("", text, "")
        }
    }
    return out
}

export function page_text(model: site_model, page: page): string {
    const names = collect_names(model, page.lang)
    const attrs = page.node.attrs
    const facts: [string, string][] = [
        ["Date", attrs.date ?? ""],
        ["Role", attrs.role ?? ""],
        ["Context", attrs.sub ?? ""],
        ["Summary", attrs.short ?? ""],
        ["Notes", attrs.note ?? ""],
        ["Skills", resolve_list(attrs.skill, names.skills)],
        [
            "Technologies",
            resolve_list([attrs.stack, attrs.feature_stack].filter(Boolean).join(","), names.stacks)
        ],
        ["Tags", attrs.tags ?? ""],
        ["Website", attrs.website ? link_target(model, page.lang, attrs.website) : ""],
        ["Paper", attrs.paper ? link_target(model, page.lang, attrs.paper) : ""],
        ["Source", attrs.source ? link_target(model, page.lang, attrs.source) : ""]
    ]
    const lines = facts.filter(([, value]) => value).map(([label, value]) => `- ${label}: ${one_line(value)}`)
    const body = page.node.children.flatMap((node) => node_lines(model, page, node, names))
    return [...(lines.length ? [...lines, ""] : []), ...body]
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
}

export function llms_full_txt(model: site_model): string {
    const lang = model.config.default_language
    const pages = pages_in(model, lang).filter((page) => indexable(model, page))
    const ordered = [
        ...pages.filter((page) => page.path === "/"),
        ...[...pages.filter((page) => page.path !== "/")].sort((a, b) => a.path.localeCompare(b.path))
    ]
    const out: string[] = [`# ${model.config.site_name}`, ""]
    const summary = one_line(site_summary(model))
    if (summary) out.push(`> ${summary}`, "")
    for (const page of ordered) {
        out.push("---", "", `## ${page.name}`, "", `URL: ${canonical_url(model, page)}`, "")
        const info = one_line(page_description(model, page))
        if (info) out.push(info, "")
        const text = page_text(model, page)
        if (text) out.push(text, "")
    }
    return (
        out
            .join("\n")
            .replace(/\n{3,}/g, "\n\n")
            .trimEnd() + "\n"
    )
}
