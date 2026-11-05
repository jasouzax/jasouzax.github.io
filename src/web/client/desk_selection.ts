export type file_selection = {
    selection: Set<string>
    anchor: string | null
    range_base: Set<string> | null
}

export function selection_click(state: file_selection, visible: string[], path: string, ctrl: boolean, shift: boolean): file_selection {
    const start = state.anchor === null ? -1 : visible.indexOf(state.anchor)
    const end = visible.indexOf(path)
    if (shift && start >= 0 && end >= 0) {
        const base = state.range_base ?? new Set(state.selection)
        const range = visible.slice(Math.min(start, end), Math.max(start, end) + 1)
        return { selection: new Set([...base, ...range]), anchor: state.anchor, range_base: base }
    }
    const selection = ctrl ? new Set(state.selection) : new Set<string>()
    if (ctrl && selection.has(path)) selection.delete(path)
    else selection.add(path)
    return { selection, anchor: path, range_base: null }
}
