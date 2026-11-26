import type { fs_node } from "./opfs.ts"

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
                const readable = await handle.queryPermission({ mode: "read" }) === "granted"
                const writable = await handle.queryPermission({ mode: "readwrite" }) === "granted"
                if (node.handle !== handle) return
                node.readable = readable
                node.write_allowed = writable
            }
        } catch {
            if (node.handle !== handle) return
            node.readable = false
            node.write_allowed = false
        }
        if (node.kind === "file" && handle?.getFile && node.readable !== false) {
            try { await handle.getFile(); node.content_readable = true }
            catch { node.content_readable = false }
        }
    }))
}

// Aliases in /net can refer to the same directory through different filesystem roots.
export function recursive_target(source: fs_node, target: fs_node): boolean {
    if (source.kind !== "dir") return false
    if (source.path === "/" || source.path === "/net") return true
    const identity = (node: fs_node): unknown => {
        const handle = node.handle as { native_handle?: unknown } | null
        return handle?.native_handle || handle
    }
    for (let parent: fs_node | null = target; parent; parent = parent.parent) if (source.handle && identity(parent) === identity(source)) return true
    return false
}

export async function check_directory_target(source: fs_node, target: fs_node): Promise<void> {
    if (source.kind !== "dir") return
    if (recursive_target(source, target)) throw new DOMException("Cannot place a directory inside itself", "InvalidModificationError")
    const unwrap = (handle: unknown): any => {
        const seen = new Set<unknown>()
        while (handle && !seen.has(handle) && (handle as { native_handle?: unknown }).native_handle) { seen.add(handle); handle = (handle as { native_handle: unknown }).native_handle }
        return handle
    }
    const from = unwrap(source.handle), to = unwrap(target.handle)
    // OPFS computers have independent roots underneath one browser storage directory.
    if (from?.resolve && to?.resolve) {
        const relative = await from.resolve(to)
        if (relative !== null) throw new DOMException("Cannot place a directory inside itself", "InvalidModificationError")
    }
}
