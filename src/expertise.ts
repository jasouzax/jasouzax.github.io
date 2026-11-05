import type { xml_node } from "./xml.ts"
import { child_nodes, where_of } from "./xml.ts"
import type { site_model, page } from "./model.ts"
import { pages_in, page_url, section_of, ui_text } from "./model.ts"
import { report_error, report_warning } from "./diag.ts"
import type { year_month } from "./dates.ts"
import { parse_date, format_label } from "./dates.ts"
import { is_true } from "./schema.ts"
import { round_to, slugify, split_list, unique } from "./util.ts"

export const default_state = "expertise"

export type skill = { id: string, name: string, icon: string, info: string, group: string }
export type stack_def = { id: string, name: string, link: string, tag: string }

export type bar = {
    id: string, name: string, sub: string, info: string, image: string
    date_label: string, period: string, resume: "" | "education" | "experience"
    // calendar parts and the wording a fixed-format resume (rirekisho) uses for the start and end of the period
    start_ym: year_month, end_ym: year_month, ongoing: boolean, resume_start: string, resume_end: string
    start: number, end: number, lane: number, ord: number, states: string[]
}

export type entry = {
    id: string, name: string, short: string, note: string, role: string, sub: string, desc: string
    date_label: string, at: number, lane: number, ord: number
    media: string, poster: string, alt: string, website: string, paper: string, event: string, source: string
    href: string | null, states: string[], during: string[]
    stacks: Record<string, string[]>, tags: string[], rank: number | null
}

export type expertise_model = {
    skills: skill[]
    groups: { name: string, skills: skill[] }[]
    stack_defs: Map<string, stack_def>
    bars: bar[]
    entries: entry[]
    state_ids: string[]
    range: Record<string, [number, number]>
    chips: Record<string, string[]>
    chip_labels: Record<string, Record<string, string>>
    years: number[]
    now_mark: number
}

function entry_pages(model: site_model, lang: string): page[] {
    const starts = ["/projects/"]
    return pages_in(model, lang).filter(page => starts.some(start => page.path.startsWith(start)) && page.node.attrs.date)
}

function make_skill(node: xml_node): skill {
    return {
        id: node.attrs.id ?? slugify(node.attrs.name),
        name: node.attrs.name,
        icon: node.attrs.icon ?? "",
        info: node.attrs.info ?? "",
        group: node.attrs.group ?? "",
    }
}

function make_stack_def(node: xml_node): stack_def {
    const id = node.attrs.id ?? slugify(node.attrs.name)
    return { id, name: node.attrs.name, link: node.attrs.link ?? "", tag: node.attrs.tag ?? node.attrs.name.replace(/\s+/g, "") }
}

function compare_entries(a: entry, b: entry): number {
    const rank_a = a.rank ?? -Infinity
    const rank_b = b.rank ?? -Infinity
    if (rank_a !== rank_b) return rank_b - rank_a
    return b.at - a.at
}

function parse_featured_chips(text: string): { id: string, label: string | null }[] {
    return text.split(";").map(part => part.trim()).filter(part => part.length > 0).map(part => {
        const cut = part.indexOf("=")
        if (cut === -1) return { id: part, label: null }
        return { id: part.slice(0, cut).trim(), label: part.slice(cut + 1).trim() }
    })
}

function apply_featured_chips(model: site_model, node: xml_node, data: { chips: Record<string, string[]>, labels: Record<string, Record<string, string>> }, add_stack: (id: string, where: string) => void): void {
    if (!node.attrs.featured_chips) return
    const wanted = parse_featured_chips(node.attrs.featured_chips)
    data.labels[default_state] = {}
    for (const { id, label } of wanted) {
        if (!data.chips[default_state].includes(id)) report_warning(model.diag, where_of(node), `featured chip "${id}" is not used by any featured project`)
        add_stack(id, where_of(node))
        if (label) data.labels[default_state][id] = label
    }
    data.chips[default_state] = wanted.map(item => item.id)
}

function assign_bar_lanes(bars: bar[]): void {
    const lane_ends: number[] = []
    for (const bar of [...bars].sort((a, b) => a.start - b.start)) {
        let lane = lane_ends.findIndex(end => end <= bar.start)
        if (lane === -1) lane = lane_ends.length
        lane_ends[lane] = bar.end
        bar.lane = lane
    }
}

function assign_pin_lanes(entries: entry[]): void {
    const lane_count = 2
    const last_at: number[] = Array(lane_count).fill(-Infinity)
    for (const entry of [...entries].sort((a, b) => a.at - b.at)) {
        const free = last_at.findIndex(at => at < entry.at - 0.35)
        const widest = last_at.indexOf(Math.min(...last_at))
        entry.lane = free === -1 ? widest : free
        last_at[entry.lane] = entry.at
    }
}

function resolve_state(wanted: string, valid: string[], where: string, model: site_model): string | null {
    const id = valid.includes(wanted) ? wanted : valid.find(state => state === slugify(wanted))
    if (id) return id
    report_error(model.diag, where, `unknown skill or event "${wanted}"`)
    return null
}

function chips_for(entries: entry[], state: string): string[] {
    return unique(entries.filter(entry => entry.states.includes(state)).flatMap(entry => entry.stacks[state] ?? []))
}

function range_for(model: site_model, bars: bar[], entries: entry[], state: string, fallback: [number, number] | null): [number, number] {
    const bar_items = bars.filter(bar => bar.states.includes(state))
    const pin_items = entries.filter(entry => entry.states.includes(state))
    const starts = [...bar_items.map(bar => bar.start), ...pin_items.map(entry => entry.at)]
    const ends = [...bar_items.map(bar => bar.end), ...pin_items.map(entry => entry.at)]
    if (starts.length === 0 && fallback) return fallback
    if (starts.length === 0) return [Math.floor(model.now) - 1, Math.ceil(model.now)]
    const now_top = Math.ceil(model.now * 10) / 10
    const last = Math.max(...ends)
    const t1 = last > model.now - 1 ? now_top : Math.ceil(last)
    return [Math.floor(Math.min(...starts)), t1]
}

// The text readers see for a date or a range. The date written in the XML stays English (it is what parse_date reads); see format_label.
function shown_label(model: site_model, lang: string, span_label: string): string {
    return format_label(span_label, lang, ui_text(model, lang, "present"))
}

export function build_expertise(model: site_model, lang: string): expertise_model | null {
    const host = pages_in(model, lang).find(page => section_of(page, "expertise"))
    if (!host) return null
    const node = section_of(host, "expertise")!
    const skills = child_nodes(node, "skill").map(make_skill)
    const stack_nodes = [...child_nodes(node, "stack"), ...child_nodes(node, "skill").flatMap(skill => child_nodes(skill, "stack"))]
    const stack_defs = new Map(stack_nodes.map(make_stack_def).map(def => [def.id, def]))
    const events = child_nodes(node, "event")
    const bars: bar[] = []
    const entries: entry[] = []
    const skill_ids = skills.map(skill => skill.id)
    const bar_ids = events.filter(event => parse_date(event.attrs.date, model.now)?.end != null).map(event => event.attrs.id ?? slugify(event.attrs.name))
    const state_ids = [default_state, ...skill_ids, ...bar_ids]
    const add_stack = (id: string, where: string): void => {
        if (stack_defs.has(id)) return
        report_warning(model.diag, where, `stack "${id}" has no <stack> definition, using its id as the label`)
        stack_defs.set(id, { id, name: id, link: "", tag: id })
    }
    for (const event of events) {
        const span = parse_date(event.attrs.date, model.now)
        if (!span) {
            report_error(model.diag, where_of(event), `invalid date "${event.attrs.date}"`)
            continue
        }
        const id = event.attrs.id ?? slugify(event.attrs.name)
        const wanted = split_list(event.attrs.skill).map(item => resolve_state(item, state_ids, where_of(event), model)).filter((item): item is string => item !== null)
        const states = unique([...(is_true(event.attrs.featured) || span.end !== null ? [default_state] : []), ...wanted])
        const label = shown_label(model, lang, span.label)
        if (span.end !== null) {
            const note = event.attrs.note ? ` (${event.attrs.note})` : ""
            const resume = event.attrs.resume ?? ""
            if (resume !== "" && resume !== "education" && resume !== "experience") report_error(model.diag, where_of(event), `resume must be "education" or "experience", not "${resume}"`)
            bars.push({
                id, name: event.attrs.name, sub: event.attrs.sub ?? "", info: event.attrs.info ?? "", image: event.attrs.image ?? "",
                period: label, resume: resume === "education" || resume === "experience" ? resume : "",
                start_ym: span.start_ym, end_ym: span.end_ym ?? span.start_ym, ongoing: span.ongoing,
                resume_start: event.attrs.resume_start ?? "", resume_end: event.attrs.resume_end ?? "",
                date_label: label + note, start: round_to(span.start, 2), end: round_to(span.end, 2), lane: 0,
                ord: Math.round((span.start - 2000) * 100), states: unique([...states, id]),
            })
            continue
        }
        entries.push(entry_from_event(event, id, label, span.start, states))
    }
    for (const page of entry_pages(model, lang)) {
        const object = model.objects.find(node => node.tag === "project" && node.attrs.id === page.path.split("/").pop() && node.attrs.lang === lang)
        const slides = object?.children.filter(node => node.tag === "slide") ?? []
        const featured = slides.find(node => node.attrs.featured === "true") ?? slides[0]
        const seen = new Set<string>()
        for (const slide of slides) {
            const skills = split_list(slide.attrs.skill).filter(id => {
                if (!skill_ids.includes(id)) { report_warning(model.diag, where_of(slide), `undeclared slide skill "${id}" is omitted`); return false }
                if (seen.has(id)) { report_error(model.diag, where_of(slide), `project has more than one slide for skill "${id}"`); return false }
                seen.add(id)
                return true
            })
            const attrs = { ...page.node.attrs, ...slide.attrs, info: slide.attrs.description ?? slide.text.trim() ?? page.info,
                skill: skills.join(","), featured: slide === featured && page.node.attrs.featured === "true" ? "true" : "false" }
            const entry = entry_from_page(model, { ...page, info: attrs.info || page.info, node: { ...page.node, attrs } }, lang, state_ids, add_stack)
            if (entry) entries.push(entry)
        }
    }
    entries.sort(compare_entries)
    assign_bar_lanes(bars)
    assign_pin_lanes(entries)
    for (const entry of entries) entry.during = bars.filter(bar => bar.start <= entry.at && entry.at <= bar.end).map(bar => bar.id)
    const range: Record<string, [number, number]> = {}
    const global = range_for(model, bars, entries, default_state, null)
    for (const state of state_ids) range[state] = bar_ids.includes(state) ? range_for(model, bars, entries, state, global) : global
    const chips: Record<string, string[]> = {}
    for (const state of state_ids) chips[state] = chips_for(entries, state)
    const chip_labels: Record<string, Record<string, string>> = {}
    apply_featured_chips(model, node, { chips, labels: chip_labels }, add_stack)
    const group_names = unique(skills.map(skill => skill.group))
    const groups = group_names.map(name => ({ name, skills: skills.filter(skill => skill.group === name) }))
    const years: number[] = []
    for (let year = global[0]; year <= Math.floor(global[1]); year++) years.push(year)
    return { skills, groups, stack_defs, bars, entries, state_ids, range, chips, chip_labels, years, now_mark: Math.floor(model.now * 10) / 10 }
}

function entry_from_event(event: xml_node, id: string, label: string, at: number, states: string[]): entry {
    return {
        id, name: event.attrs.name, short: event.attrs.name, note: event.attrs.sub ?? "", role: event.attrs.type ?? "event", sub: event.attrs.info ?? "",
        desc: event.attrs.info ?? "", date_label: label, at: round_to(at, 2), lane: 0, ord: Math.round((2030 - at) * 100),
        media: "", poster: "", alt: "", website: "", paper: "", event: "", source: "", href: null, states, during: [], stacks: {}, tags: [], rank: null,
    }
}

function entry_from_page(model: site_model, page: page, lang: string, state_ids: string[], add_stack: (id: string, where: string) => void): entry | null {
    const attrs = page.node.attrs
    const where = where_of(page.node)
    const span = parse_date(attrs.date, model.now)
    if (!span) {
        report_error(model.diag, where, `invalid date "${attrs.date}"`)
        return null
    }
    const wanted = split_list(attrs.skill).map(item => resolve_state(item, state_ids, where, model)).filter((item): item is string => item !== null)
    const states = unique([...(is_true(attrs.featured) ? [default_state] : []), ...wanted])
    const all_stack = split_list(attrs.stack)
    const feature_stack = attrs.feature_stack ? split_list(attrs.feature_stack) : all_stack
    for (const id of [...all_stack, ...feature_stack]) add_stack(id, where)
    const stacks: Record<string, string[]> = {}
    for (const state of states) stacks[state] = state === default_state ? feature_stack : all_stack
    return {
        id: page.path.split("/").pop()!, name: page.name, short: attrs.short ?? page.name, note: attrs.note ?? "", role: attrs.role ?? "", sub: attrs.sub ?? "",
        desc: page.info, date_label: shown_label(model, lang, span.label), at: round_to(span.start, 2), lane: 0, ord: Math.round((2030 - span.start) * 100),
        media: attrs.media ?? "", poster: attrs.poster ?? "", alt: attrs.alt ?? "", website: attrs.website ?? "", paper: attrs.paper ?? "", event: attrs.event ?? "", source: attrs.source ?? "",
        href: page_url(model, page), states, during: [],
        stacks, tags: attrs.tags ? split_list(attrs.tags) : all_stack.slice(0, 3), rank: page.rank,
    }
}

function scss_list(items: string[]): string {
    return `(${items.map(item => JSON.stringify(item)).join(", ")}${items.length === 1 ? "," : ""})`
}

function scss_map(pairs: [string, string][]): string {
    if (pairs.length === 0) return "()"
    return `(${pairs.map(([key, value]) => `${JSON.stringify(key)}: ${value}`).join(", ")})`
}

export function scss_data(data: expertise_model | null): string {
    if (!data) return `$default: "${default_state}"; $skills: (); $exps: (); $range: (); $chips: (); $slides: ();`
    const skill_ids = data.skills.map(skill => skill.id)
    const bar_ids = data.bars.map(bar => bar.id)
    const range = scss_map(data.state_ids.map(id => [id, `(${data.range[id][0]}, ${data.range[id][1]})`]))
    const chips = scss_map(data.state_ids.map(id => [id, scss_list(data.chips[id])]))
    const by_project = new Map<string, entry>()
    for (const entry of data.entries) {
        const previous = by_project.get(entry.id)
        by_project.set(entry.id, previous ? { ...entry, states: unique([...previous.states, ...entry.states]), stacks: { ...previous.stacks, ...entry.stacks }, during: unique([...previous.during, ...entry.during]) } : entry)
    }
    const slides = scss_map([...by_project.values()].filter(entry => entry.href !== null || entry.states.length > 0).map(entry => [entry.id, `(states: ${scss_list(entry.states)}, stacks: ${scss_map(Object.entries(entry.stacks).map(([state, list]): [string, string] => [state, scss_list(list)]))}, during: ${scss_list(entry.during)})`]))
    return [`$default: "${default_state}";`, `$skills: ${scss_list(skill_ids)};`, `$exps: ${scss_list(bar_ids)};`, `$range: ${range};`, `$chips: ${chips};`, `$slides: ${slides};`].join("\n")
}
