/*
 * Flow links: which windows are split children of which, and what a parent tells its children when its resource or its text changes.
 *
 * Entities
 *   adopt / release_links   put a child under a parent, take a closing window out of its links (its children become ordinary windows)
 *   children_of             the live children of a window
 *   flow_kind_of            the flow of a child right now ("" for an ordinary window or an empty child)
 *   refresh_children        the parent's resource changed: every child draws itself again
 *   announce_edit           the parent's text changed (every keystroke): bytes go to whoever listens, see subscribe_edits
 *   latest_bytes            the newest unsaved bytes a window announced, so a child made later starts from what is on screen
 *
 * Limits
 *   No DOM and no rendering: drawing is done through link_hooks.render, which desk_view installs (this file only imports types).
 *   A window is one parent's child at most; a child can itself be split, so links form a tree.
 */
import type { desk_window } from "./desk.ts"
import type { Flow_Kind } from "../../plugin_types.ts"
import { flow_of } from "./desk_flow_rules.ts"

export const link_hooks = {
    render: (_item: desk_window): void => {},
}

const kids = new WeakMap<desk_window, Set<desk_window>>()
const listeners = new WeakMap<desk_window, Set<(bytes: Uint8Array) => void>>()
const dirty = new WeakSet<desk_window>()
const resources = new WeakMap<desk_window, unknown[]>()
const newest = new WeakMap<desk_window, Uint8Array>()

export function children_of(item: desk_window): desk_window[] {
    return [...(kids.get(item) ?? [])]
}

export function adopt(parent: desk_window, child: desk_window): void {
    resources.set(parent, resource_of(parent))
    child.parent = parent
    if (!kids.has(parent)) kids.set(parent, new Set())
    kids.get(parent)!.add(child)
}

export function flow_kind_of(item: desk_window): Flow_Kind | "" {
    return item.parent ? flow_of(item.picks) : ""
}

function resource_of(item: desk_window): unknown[] {
    return [item.file, item.path, item.mime, item.name, item.pid, item.error]
}

export function refresh_children(item: desk_window): void {
    const next = resource_of(item), previous = resources.get(item)
    resources.set(item, next)
    if (previous && next.every((value, index) => value === previous[index])) return
    for (const child of children_of(item)) link_hooks.render(child)
}

// Only mirrors share a document; a comparison or conversion owns its output.
export function document_of(item: desk_window): desk_window {
    return item.parent && flow_kind_of(item) === "mirror" ? document_of(item.parent) : item
}

export function is_dirty(item: desk_window): boolean { return dirty.has(document_of(item)) }

export function accept_save(item: desk_window, file: Blob, bytes: Uint8Array | null): void {
    const root = document_of(item)
    root.file = file
    if (latest_bytes(root) === bytes) dirty.delete(root)
    if (bytes) for (const listener of [...(listeners.get(root) ?? [])]) listener(latest_bytes(root)!)
}

// A closing window leaves its parent, and its children stop being children. With `redraw` they are drawn again as ordinary windows
// (what they hold stays); a desk that is being thrown away passes false.
export function release_links(item: desk_window, redraw: boolean): void {
    const held = latest_bytes(item), changed = is_dirty(item)
    item.parent && kids.get(item.parent)?.delete(item)
    item.parent = null
    if (held) newest.set(item, held)
    if (changed) dirty.add(item)
    const orphans = children_of(item)
    kids.delete(item)
    for (const child of orphans) {
        const bytes = latest_bytes(child)
        const changed = is_dirty(child)
        child.parent = null
        if (bytes) newest.set(child, bytes)
        if (changed) dirty.add(child)
        if (redraw) link_hooks.render(child)
    }
}

// ---- edits ------------------------------------------------------------------------------------------------------------------------

export function announce_edit(item: desk_window, bytes: Uint8Array): void {
    const root = document_of(item)
    newest.set(root, bytes)
    dirty.add(root)
    for (const listener of [...(listeners.get(root) ?? [])]) listener(bytes)
}

export function latest_bytes(item: desk_window): Uint8Array | null {
    return newest.get(document_of(item)) ?? null
}

// A body drawn from the file (again) starts from the file, so what was announced before is stale.
export function forget_edits(item: desk_window): void {
    newest.delete(item)
    dirty.delete(item)
}

export function subscribe_edits(item: desk_window, listener: (bytes: Uint8Array) => void): () => void {
    const root = document_of(item)
    if (!listeners.has(root)) listeners.set(root, new Set())
    listeners.get(root)!.add(listener)
    return () => { listeners.get(root)?.delete(listener) }
}
