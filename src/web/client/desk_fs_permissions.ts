import type { fs_node } from "./desk_fs.ts"

function accessible(node: fs_node): boolean {
    for (let parent: fs_node | null = node; parent; parent = parent.parent) if (parent.readable === false || parent.content_readable === false) return false
    return true
}

export function can_read(node: fs_node): boolean {
    if (!accessible(node)) return false
    if (node.kind === "file") return !!node.handle
    return (node.children ?? []).every(can_read)
}

export function can_browse(node: fs_node): boolean { return node.kind === "dir" && accessible(node) }

export function can_create(node: fs_node | null): boolean {
    if (!node || node.kind !== "dir" || !node.writable || !node.handle || !accessible(node)) return false
    for (let parent: fs_node | null = node; parent; parent = parent.parent) if (parent.write_allowed === false) return false
    return true
}

export function can_move(node: fs_node): boolean {
    return !!node.parent && !node.mount && !!node.handle && node.write_allowed !== false && can_create(node.parent)
}

// Permission checks never prompt; a denied/pending permission is reflected in the controls.
export async function check_permissions(nodes: fs_node[]): Promise<void> {
    const seen = new Set<fs_node>()
    for (const node of nodes) for (let parent: fs_node | null = node; parent; parent = parent.parent) seen.add(parent)
    await Promise.all([...seen].map(async node => {
        const handle = node.handle as { queryPermission?: (options: { mode: string }) => Promise<string>, getFile?: () => Promise<unknown> } | null
        try {
            if (handle?.queryPermission) {
                node.readable = await handle.queryPermission({ mode: "read" }) === "granted"
                node.write_allowed = await handle.queryPermission({ mode: "readwrite" }) === "granted"
            }
        } catch {
            node.readable = false
            node.write_allowed = false
        }
        if (node.kind === "file" && handle?.getFile && node.readable !== false) {
            try { await handle.getFile(); node.content_readable = true }
            catch { node.content_readable = false }
        }
    }))
}
