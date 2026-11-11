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
const newest = new WeakMap<desk_window, Uint8Array>()

export function children_of(item: desk_window): desk_window[] {
    return [...(kids.get(item) ?? [])]
}

export function adopt(parent: desk_window, child: desk_window): void {
    child.parent = parent
    if (!kids.has(parent)) kids.set(parent, new Set())
    kids.get(parent)!.add(child)
}

export function flow_kind_of(item: desk_window): Flow_Kind | "" {
    return item.parent ? flow_of(item.picks) : ""
}

export function refresh_children(item: desk_window): void {
    for (const child of children_of(item)) link_hooks.render(child)
}

// A closing window leaves its parent, and its children stop being children. With `redraw` they are drawn again as ordinary windows
// (what they hold stays); a desk that is being thrown away passes false.
export function release_links(item: desk_window, redraw: boolean): void {
    item.parent && kids.get(item.parent)?.delete(item)
    item.parent = null
    const orphans = children_of(item)
    kids.delete(item)
    for (const child of orphans) {
        child.parent = null
        if (redraw) link_hooks.render(child)
    }
}

// ---- edits ------------------------------------------------------------------------------------------------------------------------

export function announce_edit(item: desk_window, bytes: Uint8Array): void {
    newest.set(item, bytes)
    for (const listener of listeners.get(item) ?? []) listener(bytes)
}

export function latest_bytes(item: desk_window): Uint8Array | null {
    return newest.get(item) ?? null
}

// A body drawn from the file (again) starts from the file, so what was announced before is stale.
export function forget_edits(item: desk_window): void {
    newest.delete(item)
}

export function subscribe_edits(item: desk_window, listener: (bytes: Uint8Array) => void): () => void {
    if (!listeners.has(item)) listeners.set(item, new Set())
    listeners.get(item)!.add(listener)
    return () => { listeners.get(item)?.delete(listener) }
}
