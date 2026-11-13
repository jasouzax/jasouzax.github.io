/*
 * Plugin manifest contract and case matching, shared by the build (validation) and the browser (desk runtime). No DOM, no I/O.
 *
 * Entities
 *   plugin_info / plugin_case   the compiled manifest of one <plugin> and one <case> (attributes stay strings, as authored)
 *   plugin_target               what a case is matched against: a resource's mime, path, mode and whether it holds file data
 *   Flow_Kind                   how a split child relates to its parent: convert, compare or mirror
 *   select_case                 the case for an ordinary window
 *   select_flow_case            the case for a split child, matching the parent (plain attributes) and the child (child_* attributes)
 *
 * Limits
 *   A case with any child_* attribute is a flow case: it never applies to an ordinary window, and ordinary cases never apply to a child's flow.
 *   Which Flow_Kind a case serves is inferred from its child_* attributes (case_flow), so authors never write the kind down.
 */
export type plugin_info = {
    id: string
    version: string
    name?: string
    icon?: string
    mime?: string
    path?: string
    mode?: string
    from?: string
    to?: string
    flow?: string
    wasm?: string
    sha256?: string
    script?: string
    options?: string
    cases?: plugin_case[]
}

export type plugin_case = {
    file?: string
    error?: string
    view?: string
    edit?: string
    mime?: string
    url?: string
    host?: Plugin_Host
    script?: string
    // The same conditions, applied to the split child instead of the parent (see select_flow_case)
    child_file?: string
    child_view?: string
    child_edit?: string
    child_mime?: string
    child_url?: string
}

export const plugin_hosts = ["text", "hex", "media", "shell", "markdown", "folder", "html", "pdf", "image_pdf", "mirror", "default"] as const
export type Plugin_Host = typeof plugin_hosts[number]
export type Flow_Kind = "convert" | "compare" | "mirror"
export const flow_kinds: readonly Flow_Kind[] = ["convert", "compare", "mirror"]
const child_attributes = ["child_file", "child_view", "child_edit", "child_mime", "child_url"] as const

export type plugin_target = { mime: string, path: string, mode: string, file?: Blob | null, error?: string }

function explicit_match(pattern: string | undefined, value: string): boolean {
    return !!pattern?.split(",").some(part => !part.includes("*") && part.trim().toLowerCase() === value.toLowerCase())
}

function modes_allow(view: string | undefined, edit: string | undefined, mode: string): boolean {
    if (view === undefined && edit === undefined) return true
    return mode === "view" ? view === "true" : mode === "edit" && edit === "true"
}

function file_allows(wanted: string | undefined, file: Blob | null | undefined): boolean {
    return wanted === undefined || (wanted === "true") === !!file
}

function resource_allows(entry: plugin_case, item: plugin_target): boolean {
    return file_allows(entry.file, item.file) && (entry.error === "true") === !!item.error && modes_allow(entry.view, entry.edit, item.mode)
}

function child_allows(entry: plugin_case, child: plugin_target): boolean {
    return file_allows(entry.child_file, child.file) && modes_allow(entry.child_view, entry.child_edit, child.mode)
}

export function is_child_case(entry: plugin_case): boolean {
    return child_attributes.some(name => entry[name] !== undefined)
}

// A case's flow is read from what it says about the child: its own resource (child_file or child_url) means compare, a child type means
// convert, and only a child mode means mirror. "" is an ordinary case.
export function case_flow(entry: plugin_case): Flow_Kind | "" {
    if (!is_child_case(entry)) return ""
    if (entry.child_file === "true" || entry.child_url !== undefined) return "compare"
    return entry.child_mime !== undefined ? "convert" : "mirror"
}

export function plugin_serves_flow(plugin: plugin_info, kind: Flow_Kind): boolean {
    return !plugin.flow || plugin.flow.split(",").some(part => part.trim().toLowerCase() === kind)
}

// An exact resource selector reserves that resource for this case, even when its
// state/mode check rejects it. Later broad cases cannot undo that exclusion.
export function select_case(cases: plugin_case[], item: plugin_target): plugin_case | null {
    for (const entry of cases) {
        if (is_child_case(entry)) continue
        if (!trigger_matches(entry.mime, item.mime) || !trigger_matches(entry.url, item.path)) continue
        if (resource_allows(entry, item)) return entry
        if (explicit_match(entry.mime, item.mime) || explicit_match(entry.url, item.path)) return null
    }
    return null
}

// The case for a split child. `source` is the parent's resource (plain attributes), `child` is the child's (child_* attributes); only cases
// serving `kind` are considered. Reservation is per side: an exact parent selector reserves the parent when the parent's state fails the case,
// an exact child selector reserves the child when the child's state fails it, so one side's mode never shadows the other's cases.
export function select_flow_case(cases: plugin_case[], kind: Flow_Kind, source: plugin_target, child: plugin_target): plugin_case | null {
    for (const entry of cases) {
        if (case_flow(entry) !== kind) continue
        const patterns = trigger_matches(entry.mime, source.mime) && trigger_matches(entry.url, source.path)
            && trigger_matches(entry.child_mime, child.mime) && trigger_matches(entry.child_url, child.path)
        if (!patterns) continue
        const source_ok = resource_allows(entry, source)
        const child_ok = child_allows(entry, child)
        if (source_ok && child_ok) return entry
        if (!source_ok && (explicit_match(entry.mime, source.mime) || explicit_match(entry.url, source.path))) return null
        if (!child_ok && (explicit_match(entry.child_mime, child.mime) || explicit_match(entry.child_url, child.path))) return null
    }
    return null
}

export function trigger_matches(pattern: string | undefined, value: string): boolean {
    if (!pattern) return true
    return pattern.split(",").some(part => {
        const expression = part.trim().split("*").map(piece => piece.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")
        return new RegExp(`^${expression}$`, "i").test(value)
    })
}

export function plugin_matches(plugin: plugin_info, item: { mime: string, path: string, mode: string }): boolean {
    return trigger_matches(plugin.mime, item.mime) && trigger_matches(plugin.path, item.path) && trigger_matches(plugin.mode, item.mode)
}
