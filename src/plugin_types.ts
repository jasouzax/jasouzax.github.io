// Shared manifest contract. Behavior modules are loaded only by the desk runtime.
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
    host?: "text" | "hex" | "media" | "shell" | "markdown" | "default"
    script?: string
}

export type plugin_target = { mime: string, path: string, mode: string, file?: Blob | null, error?: string }

function explicit_match(pattern: string | undefined, value: string): boolean {
    return !!pattern?.split(",").some(part => !part.includes("*") && part.trim().toLowerCase() === value.toLowerCase())
}

// An exact resource selector reserves that resource for this case, even when its
// state/mode check rejects it. Later broad cases cannot undo that exclusion.
export function select_case(cases: plugin_case[], item: plugin_target): plugin_case | null {
    for (const entry of cases) {
        if (!trigger_matches(entry.mime, item.mime) || !trigger_matches(entry.url, item.path)) continue
        const modes = entry.view !== undefined || entry.edit !== undefined
        const allowed = (entry.file === undefined || (entry.file === "true") === !!item.file)
            && (entry.error === "true") === !!item.error
            && (!modes || (item.mode === "view" ? entry.view === "true" : item.mode === "edit" && entry.edit === "true"))
        if (allowed) return entry
        if (explicit_match(entry.mime, item.mime) || explicit_match(entry.url, item.path)) return null
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
