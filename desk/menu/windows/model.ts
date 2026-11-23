/* Browser-local desktop snapshots: bounded documents and an acyclic split graph, not live processes. */
export type Desktop_Layout = { rows: number[][], columns: number[], heights: number[], custom: boolean, focused: number | null, maximized: number | null }
export type Saved_Window = {
    id: number, parent: number | null, name: string, mime: string, mode: string, icon: string, path: string,
    file: Blob | null, draft: Blob | null, dirty: boolean, hidden: boolean, minimized: boolean,
    picks: { own: boolean, mime: boolean, mode: boolean }, audio: { enabled: boolean, volume: number },
}
export type Desktop_Snapshot = { windows: Saved_Window[], layout: Desktop_Layout, cwd: string }
export type Saved_Desktop = Desktop_Snapshot & { version: 1, id: string, name: string, key: string, revision: number, updated: number }
export function desktop_name_key(name: string): string { return name.trim().normalize("NFKC").toLowerCase() }
export function valid_desktop_name(name: string): boolean { return Boolean(name.trim()) && name.trim().length <= 80 && !/[\x00-\x1f\x7f]/.test(name) }
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value)
const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0
const path = (value: unknown): value is string => typeof value === "string" && value.startsWith("/") && value.length <= 4096 && !/[\\\x00-\x1f]/.test(value) && !value.split("/").some(part => part === "." || part === "..")
export function validate_snapshot(value: unknown): asserts value is Desktop_Snapshot {
    if (!object(value) || !path(value.cwd) || !Array.isArray(value.windows) || value.windows.length > 64 || !object(value.layout)) throw new Error("Invalid desktop snapshot")
    const ids = new Set<number>(), parents = new Map<number, number | null>(), blobs = new Set<Blob>()
    let bytes = 0
    for (const item of value.windows) {
        if (!object(item) || !integer(item.id) || ids.has(item.id) || !(item.parent === null || integer(item.parent)) || !["", "view", "edit"].includes(item.mode)) throw new Error("Invalid desktop window")
        for (const key of ["name", "mime", "icon", "path"]) if (typeof item[key] !== "string" || item[key].length > 4096 || /\0/.test(item[key])) throw new Error("Invalid desktop resource")
        if (item.path && !path(item.path) && !(item.path.startsWith("file:///") && path(item.path.slice(7)))) {
            try { const url = new URL(item.path); if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error() }
            catch { throw new Error("Invalid desktop resource URI") }
        }
        if (/^(?:pid|server|im|window):/i.test(item.path) || /^(?:application\/auto-|message\/)/i.test(item.mime)) throw new Error("Live resources cannot be saved as a desktop")
        for (const key of ["file", "draft"]) {
            if (item[key] !== null && !(item[key] instanceof Blob)) throw new Error("Invalid desktop file")
            if (item[key] && !blobs.has(item[key])) { blobs.add(item[key]); bytes += item[key].size }
        }
        if (bytes > 64 * 1024 * 1024) throw new Error("Desktop exceeds the storage limit")
        if (item.dirty && !item.draft && !(item.parent && !item.picks?.own && !item.picks?.mime)) throw new Error("Desktop draft is missing")
        if (!item.file && item.mime && item.mime !== "inode/directory" && !(item.parent && !item.picks?.own)) throw new Error("Desktop resource is unavailable")
        if (item.mime === "inode/directory" && !/^file:\/\/\//.test(item.path)) throw new Error("Invalid desktop folder")
        for (const key of ["dirty", "hidden", "minimized"]) if (typeof item[key] !== "boolean") throw new Error("Invalid desktop visibility")
        if (!object(item.picks) || ["own", "mime", "mode"].some(key => typeof item.picks[key] !== "boolean") || !object(item.audio) || typeof item.audio.enabled !== "boolean" || !Number.isFinite(item.audio.volume) || item.audio.volume < 0 || item.audio.volume > 1) throw new Error("Invalid desktop preferences")
        ids.add(item.id); parents.set(item.id, item.parent)
    }
    for (const id of ids) {
        const visited = new Set([id]); let parent = parents.get(id)
        while (parent !== null && parent !== undefined) {
            if (!ids.has(parent) || visited.has(parent)) throw new Error("Invalid desktop split graph")
            visited.add(parent); parent = parents.get(parent)
        }
    }
    const layout = value.layout, placed = new Set<number>()
    if (!Array.isArray(layout.rows) || layout.rows.length > 64 || typeof layout.custom !== "boolean") throw new Error("Invalid desktop layout")
    for (const row of layout.rows) {
        if (!Array.isArray(row) || !row.length) throw new Error("Invalid desktop row")
        for (const id of row) { if (!ids.has(id) || placed.has(id)) throw new Error("Invalid desktop placement"); placed.add(id) }
    }
    for (const weights of [layout.columns, layout.heights]) if (!Array.isArray(weights) || weights.length > 64 || weights.some(value => typeof value !== "number" || !Number.isFinite(value) || value <= 0)) throw new Error("Invalid desktop weights")
    for (const id of [layout.focused, layout.maximized]) if (id !== null && !ids.has(id)) throw new Error("Invalid desktop focus")
}
export function validate_desktop(value: unknown): asserts value is Saved_Desktop {
    validate_snapshot(value)
    const record = value as Saved_Desktop
    if (record.version !== 1 || typeof record.id !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(record.id) || typeof record.name !== "string" || !valid_desktop_name(record.name) || record.key !== desktop_name_key(record.name) || !integer(record.revision) || !Number.isSafeInteger(record.updated) || record.updated <= 0) throw new Error("Invalid saved desktop")
}
