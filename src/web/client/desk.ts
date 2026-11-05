// The /desk runtime: the windows of a file-system desk. A desk marked data-runtime starts with no window; "New window" in the window menu
// (#head_new) clones the empty window from <template id="desk_window_template">. This file owns the list of windows, their tabs in the
// header and the layout of the desk (a grid, see arrange()). What a window shows lives in client_desk_view.ts, the files in client_desk_fs.ts.

import { init_view } from "./desk_view.ts"
import { init_fs } from "./desk_fs.ts"
import { init_proc } from "./desk_proc.ts"

export type desk_data = {
    text: Record<string, string>
    mimes: { mime: string, label: string, icon: string, extensions: string[] }[]
    file_icon: string
    icons?: Record<string, string>
    folder_icon: string
}

export type desk_window = {
    id: number
    el: HTMLElement
    tab: HTMLAnchorElement
    minimized: boolean
    // what the window holds; the viewer (client_desk_view.ts) fills these in
    name: string
    mime: string
    mode: string
    icon: string
    file: Blob | null
    // the types the detector thinks the file may be, likeliest first (client_desk_mime.ts)
    // where the file is in the file system, shown in the head ("" for a file that only lives in this window)
    path: string
    candidates: string[]
    // where an edit goes back to (a file in the file system); null for a file that only lives in this window
    save: ((blob: Blob) => Promise<void>) | null
    // the editor in the body hands back what to save (null when there is nothing valid to save); the head's save button calls it
    commit: (() => Promise<Blob | null>) | null
    // the body was edited since it was drawn or last saved, and what stops it being saved ("" when nothing does)
    dirty: boolean
    problem: string
    // the process this window shows (client_desk_proc.ts), or null
    pid: number | null
}

export const state = {
    desk: null as HTMLElement | null,
    data: null as desk_data | null,
    windows: [] as desk_window[],
    focused: null as desk_window | null,
    maximized: null as desk_window | null,
    next_id: 1,
}

// weights of the window tracks (columns and rows): resizing a gap moves weight between the two windows beside it
let col_weights: number[] = []
let row_weights: number[] = []

// The layout of the windows that are on the desk (not minimized): rows of windows, top to bottom and left to right. Every row has its own
// number of windows (the last window of a row takes the columns that are left). While `custom` is false the rows are the balanced grid
// grid_shape() gives for the windows in order; a move that changes the shape (a window dragged down into a row of its own, say) makes
// the layout custom, and then windows that come and go are only taken out of or appended to it.
let rows: desk_window[][] = []
let custom = false

const portrait = matchMedia("(orientation: portrait)")

export function text(key: string): string {
    return state.data?.text[key] ?? key
}

export function window_of(element: Element | null): desk_window | null {
    const box = element?.closest<HTMLElement>(".desk_wbox")
    return state.windows.find(item => item.el === box) ?? null
}

function read_data(): desk_data | null {
    const script = document.getElementById("desk_data")
    if (!script?.textContent) return null
    try {
        return JSON.parse(script.textContent) as desk_data
    } catch {
        return null
    }
}

// ---- tabs -------------------------------------------------------------------------------------------------------------------------

export function label_of(item: desk_window): string {
    return item.name || text("new_window")
}

export function refresh_tab(item: desk_window): void {
    const icon = item.icon ? `<span aria-hidden="true"></span>` : ""
    item.tab.innerHTML = icon
    if (item.icon) item.tab.firstElementChild!.textContent = item.icon
    const name = document.createElement("span")
    name.className = "head_tab_name"
    name.textContent = label_of(item)
    item.tab.append(name)
    item.tab.toggleAttribute("data-minimized", item.minimized)
    item.tab.toggleAttribute("data-maximized", state.maximized === item)
    item.tab.title = label_of(item)
    const mark = item.el.querySelector(".desk_wbox_head_icon")
    if (mark) mark.textContent = item.icon
}

function make_tab(item: desk_window): HTMLAnchorElement {
    const link = document.createElement("a")
    link.href = `#${item.el.id}`
    link.dataset.deskTab = String(item.id)
    document.getElementById("head_tabs")?.append(link)
    return link
}

function restore_tabs(): void {
    const nav = document.getElementById("head_tabs")
    if (!nav) return
    for (const item of state.windows) if (!item.tab.isConnected) nav.append(item.tab)
}

// ---- layout -----------------------------------------------------------------------------------------------------------------------

function shown_windows(): desk_window[] {
    let list = state.windows.filter(item => !item.minimized)
    if (state.maximized) list = [state.maximized]
    // portrait is one window at a time: the focused one. When the focused window is minimized nothing is shown (like the Windows taskbar),
    // so a tab pressed to minimize the window in view really leaves an empty desk instead of revealing another window.
    if (portrait.matches) {
        if (state.focused && list.includes(state.focused)) list = [state.focused]
        else if (state.focused?.minimized && !state.maximized) list = []
        else list = list.slice(0, 1)
    }
    return list
}

function grid_shape(count: number): { cols: number, rows: number } {
    const cols = Math.max(1, Math.ceil(Math.sqrt(count)))
    return { cols, rows: Math.max(1, Math.ceil(count / cols)) }
}

function auto_rows(list: desk_window[]): desk_window[][] {
    const { cols } = grid_shape(list.length)
    const result: desk_window[][] = []
    for (let from = 0; from < list.length; from += cols) result.push(list.slice(from, from + cols))
    return result
}

// brings `rows` in line with the windows that are not minimized: gone ones leave, new ones come in
function sync_rows(): void {
    const live = state.windows.filter(item => !item.minimized)
    const kept = rows.map(row => row.filter(item => live.includes(item))).filter(row => row.length > 0)
    const placed = new Set(kept.flat())
    const added = live.filter(item => !placed.has(item))
    if (live.length <= 1) custom = false
    if (!custom) {
        rows = auto_rows([...kept.flat(), ...added])
        return
    }
    rows = kept
    const width = Math.max(1, ...rows.map(row => row.length))
    for (const item of added) {
        const last = rows[rows.length - 1]
        if (last && last.length < width) last.push(item)
        else rows.push([item])
    }
}

function shape_key(): string {
    return rows.map(row => row.length).join(",")
}

function normalized(weights: number[], count: number): number[] {
    const list = weights.length === count ? weights.slice() : new Array<number>(count).fill(1)
    const sum = list.reduce((total, value) => total + value, 0)
    return list.map(value => value * count / sum)
}

export function fix_focus(): void {
    const list = state.windows.filter(item => !item.minimized)
    if (state.maximized && !list.includes(state.maximized)) state.maximized = null
    // A minimized window keeps the focus (so the menu's Minimize brings it back); only a window that is gone loses it.
    if (!state.focused || !state.windows.includes(state.focused)) state.focused = state.maximized ?? list[list.length - 1] ?? null
}

function apply_template(columns: number, rows: number): void {
    const desk = state.desk!
    col_weights = normalized(col_weights, columns)
    row_weights = normalized(row_weights, rows)
    const cols = ["1fr", ".25em"]
    col_weights.forEach((weight, index) => {
        if (index > 0) cols.push(".5em")
        cols.push(`minmax(0, ${(weight * 9999).toFixed(3)}fr)`)
    })
    cols.push(".25em")
    const lines: string[] = []
    row_weights.forEach((weight, index) => {
        if (index > 0) lines.push(".5em")
        lines.push(`minmax(0, ${weight.toFixed(4)}fr)`)
    })
    desk.style.gridTemplateColumns = cols.join(" ")
    desk.style.gridTemplateRows = lines.join(" ")
}

function make_gap(vertical: boolean, label: string): HTMLElement {
    const gap = document.createElement("div")
    gap.className = `desk_gap ${vertical ? "desk_gap_col" : "desk_gap_row"}`
    gap.setAttribute("role", "separator")
    gap.setAttribute("aria-orientation", vertical ? "vertical" : "horizontal")
    gap.setAttribute("aria-label", label)
    gap.tabIndex = 0
    return gap
}

export function arrange(): void {
    const desk = state.desk
    if (!desk) return
    fix_focus()
    sync_rows()
    for (const gap of desk.querySelectorAll(".desk_gap")) gap.remove()
    const shown = shown_windows()
    const flat = portrait.matches
    for (const item of state.windows) {
        const on = shown.includes(item)
        item.el.hidden = !on
        item.el.classList.toggle("is_focus", item === state.focused && !item.minimized)
        item.el.toggleAttribute("data-maximized", item === state.maximized)
        refresh_tab(item)
        if (item === state.focused && !item.minimized) item.tab.setAttribute("aria-current", "location")
        else item.tab.removeAttribute("aria-current")
    }
    desk.toggleAttribute("data-empty", state.windows.length === 0)
    if (flat) {
        desk.style.gridTemplateColumns = ""
        desk.style.gridTemplateRows = ""
        for (const item of shown) item.el.style.gridArea = ""
        return
    }
    // maximizing shows one window on the whole desk; otherwise the rows are the layout
    const layout = shown.length === rows.flat().length ? rows : shown.length ? [shown] : []
    const cols = Math.max(1, ...layout.map(row => row.length))
    const count = layout.length
    if (col_weights.length !== cols) col_weights = new Array<number>(cols).fill(1)
    if (row_weights.length !== count) row_weights = new Array<number>(Math.max(1, count)).fill(1)
    layout.forEach((row, r) => row.forEach((item, c) => {
        // the last window of a row takes the columns that are left
        const spans = c === row.length - 1 ? cols - c : 1
        const from = 3 + 2 * c
        const to = from + 2 * spans - 1
        item.el.style.gridArea = `${1 + 2 * r} / ${from} / ${2 + 2 * r} / ${to}`
    }))
    if (shown.length === 0) {
        apply_template(1, 1)
        return
    }
    apply_template(cols, count)
    // a column gap exists in the rows that have a window on both sides of it; it is one gap per run of such rows
    for (let boundary = 0; boundary < cols - 1; boundary++) {
        let from = -1
        for (let r = 0; r <= count; r++) {
            const has = r < count && layout[r].length >= boundary + 2
            if (has && from < 0) from = r
            if (!has && from >= 0) {
                const gap = make_gap(true, text("resize_windows"))
                gap.dataset.axis = "col"
                gap.dataset.index = String(boundary)
                gap.style.gridArea = `${1 + 2 * from} / ${4 + 2 * boundary} / ${2 + 2 * (r - 1)} / ${5 + 2 * boundary}`
                desk.append(gap)
                from = -1
            }
        }
    }
    for (let boundary = 0; boundary < count - 1; boundary++) {
        const gap = make_gap(false, text("resize_windows"))
        gap.dataset.axis = "row"
        gap.dataset.index = String(boundary)
        gap.style.gridArea = `${2 + 2 * boundary} / 3 / ${3 + 2 * boundary} / ${2 * cols + 2}`
        desk.append(gap)
    }
}

// ---- windows ----------------------------------------------------------------------------------------------------------------------

export function focus_window(item: desk_window | null): void {
    if (!item) return
    if (state.focused === item && !item.minimized) return
    item.minimized = false
    state.focused = item
    arrange()
}

export function new_window(): desk_window | null {
    const desk = state.desk
    const template = document.getElementById("desk_window_template") as HTMLTemplateElement | null
    if (!desk || !template) return null
    const element = template.content.firstElementChild!.cloneNode(true) as HTMLElement
    const id = state.next_id++
    element.id = `desk_win_${id}`
    element.dataset.window = String(id)
    desk.insertBefore(element, template)
    const item: desk_window = { id, el: element, tab: null as unknown as HTMLAnchorElement, minimized: false, name: "", mime: "", mode: "view", icon: "", file: null, path: "", candidates: [], save: null, commit: null, dirty: false, problem: "", pid: null }
    item.tab = make_tab(item)
    state.windows.push(item)
    state.focused = item
    window_hooks.created(item)
    arrange()
    return item
}

// the viewer and the file system hook in here (so this file does not import them)
export const window_hooks = {
    created: (_item: desk_window): void => {},
    closed: (_item: desk_window): void => {},
}

function dispose(): void {
    for (const item of state.windows) item.tab.remove()
    state.windows = []
    state.focused = null
    state.maximized = null
    state.desk = null
    col_weights = []
    row_weights = []
    rows = []
    custom = false
}

// ---- events -----------------------------------------------------------------------------------------------------------------------

function close_menu(target: Element): void {
    target.closest("details")?.removeAttribute("open")
}

function on_click(event: MouseEvent): void {
    const target = event.target as Element
    const tab = target.closest<HTMLAnchorElement>("#head_tabs a[data-desk-tab]")
    if (tab && state.desk) {
        event.preventDefault()
        const item = state.windows.find(entry => entry.id === Number(tab.dataset.deskTab))
        if (item) activate(item)
        return
    }
    const move = target.closest<HTMLElement>(".desk_wbox_head_drop button[data-move]")
    if (move && state.desk) {
        event.preventDefault()
        close_menu(move)
        const item = window_of(move)
        if (item) move_window(item, move.dataset.move ?? "")
        return
    }
    const button = target.closest<HTMLElement>("#head_new, #head_mini, #head_full, #head_exit")
    if (button && state.desk) {
        event.preventDefault()
        close_menu(button)
        if (button.id === "head_new") new_window()
        else if (button.id === "head_mini") toggle_minimize(state.focused)
        else if (button.id === "head_full") toggle_maximize(state.focused)
        else close_window(state.focused)
    }
}

export function toggle_minimize(item: desk_window | null): void {
    if (!item) return
    item.minimized = !item.minimized
    if (item.minimized && state.maximized === item) state.maximized = null
    state.focused = item
    arrange()
}

// ---- moving ---------------------------------------------------------------------------------------------------------------------
// A move changes the rows (see `rows`). Beside or inside the grid a window trades places with the window next to it; at the edge of the
// grid a move up or down puts the window in a row of its own, so a 2x1 desk (two columns, one row) becomes 1x2. Dragging the move button
// onto another window docks the window on the side of it that the pointer is on (see start_drag).

function find_window(item: desk_window): { r: number, c: number } | null {
    for (let r = 0; r < rows.length; r++) {
        const c = rows[r].indexOf(item)
        if (c >= 0) return { r, c }
    }
    return null
}

function neighbour(item: desk_window, way: string): desk_window | null {
    sync_rows()
    const at = find_window(item)
    if (!at) return null
    if (portrait.matches) {
        // one window is in view: a move left or right trades with the previous or next window, up and down do nothing
        const list = rows.flat()
        const index = list.indexOf(item)
        return (way === "right" ? list[index + 1] : way === "left" ? list[index - 1] : null) ?? null
    }
    if (way === "left") return rows[at.r][at.c - 1] ?? null
    if (way === "right") return rows[at.r][at.c + 1] ?? null
    const row = rows[way === "bottom" || way === "down" ? at.r + 1 : at.r - 1]
    // a row below or above can be shorter: the window above the missing cell is the one that spans it
    return row ? row[Math.min(at.c, row.length - 1)] : null
}

// the layout changed shape: the old weights do not fit it, and it is no longer the balanced grid
function reshaped(before: string): void {
    custom = true
    if (shape_key() !== before) {
        col_weights = []
        row_weights = []
    }
}

export function swap_windows(first: desk_window, second: desk_window): void {
    sync_rows()
    const a = find_window(first)
    const b = find_window(second)
    if (!a || !b || first === second) return
    rows[a.r][a.c] = second
    rows[b.r][b.c] = first
    // keep the list in the same order, so the window in view in portrait follows
    const x = state.windows.indexOf(first)
    const y = state.windows.indexOf(second)
    if (x >= 0 && y >= 0) {
        state.windows[x] = second
        state.windows[y] = first
    }
    state.focused = first
    arrange()
}

function take_out(item: desk_window): void {
    for (const row of rows) {
        const index = row.indexOf(item)
        if (index >= 0) row.splice(index, 1)
    }
    rows = rows.filter(row => row.length > 0)
}

// puts the window in the row of `target` (before or after it) or in a row of its own above or below that row
export function dock_window(item: desk_window, target: desk_window, side: "left" | "right" | "top" | "bottom"): void {
    sync_rows()
    if (item === target || !find_window(item) || !find_window(target)) return
    const before = shape_key()
    take_out(item)
    const at = find_window(target)!
    if (side === "left") rows[at.r].splice(at.c, 0, item)
    else if (side === "right") rows[at.r].splice(at.c + 1, 0, item)
    else rows.splice(side === "top" ? at.r : at.r + 1, 0, [item])
    reshaped(before)
    state.focused = item
    arrange()
}

export function move_window(item: desk_window, way: string): void {
    const other = neighbour(item, way)
    if (other) {
        swap_windows(item, other)
        return
    }
    // nothing beyond the edge of the grid: a window that shares its row leaves it for a row of its own
    const at = find_window(item)
    if (!at || portrait.matches || rows[at.r].length < 2) return
    const down = way === "bottom" || way === "down"
    if (!down && way !== "top" && way !== "up") return
    const before = shape_key()
    take_out(item)
    rows.splice(down ? at.r + 1 : at.r, 0, [item])
    reshaped(before)
    state.focused = item
    arrange()
}

type drop_zone = "swap" | "left" | "right" | "top" | "bottom" | ""

// where the pointer is in a window: the edge bands (a quarter of its size) dock, the middle swaps (or does nothing over the window itself)
function zone_of(box: HTMLElement, x: number, y: number): drop_zone {
    const rect = box.getBoundingClientRect()
    const fx = (x - rect.left) / Math.max(1, rect.width)
    const fy = (y - rect.top) / Math.max(1, rect.height)
    const edge = .25
    // the nearer of the two axes wins in a corner
    const dx = Math.min(fx, 1 - fx)
    const dy = Math.min(fy, 1 - fy)
    if (dx >= edge && dy >= edge) return "swap"
    if (dy / edge <= dx / edge) return fy < .5 ? "top" : "bottom"
    return fx < .5 ? "left" : "right"
}

// Dragging the move button (.desk_wbox_head_drop) over the desk: on the middle of another window the two trade places; on the edge of
// another window the dragged window docks on that side of it; on the edge of its own window it moves that way, like the menu's options. A
// press that does not travel is the ordinary click that opens the menu.
function start_drag(event: PointerEvent): void {
    const summary = (event.target as Element).closest<HTMLElement>(".desk_wbox_head_drop > summary")
    const item = summary ? window_of(summary) : null
    if (!summary || !item || event.button !== 0 || portrait.matches) return
    const from_x = event.clientX
    const from_y = event.clientY
    let dragging = false
    let over: desk_window | null = null
    let zone: drop_zone = ""
    const mark = (next: desk_window | null, next_zone: drop_zone): void => {
        if (over === next && zone === next_zone) return
        if (over) {
            over.el.classList.remove("is_swap")
            over.el.removeAttribute("data-drop")
        }
        over = next
        zone = next_zone
        if (!over || !zone) return
        // the window itself is only a target at its edges
        if (zone === "swap" && over !== item) over.el.classList.add("is_swap")
        else if (zone !== "swap") over.el.dataset.drop = zone
    }
    const move = (at: PointerEvent): void => {
        if (!dragging && Math.hypot(at.clientX - from_x, at.clientY - from_y) < 6) return
        if (!dragging) {
            dragging = true
            item.el.classList.add("is_moving")
            document.documentElement.classList.add("desk_dragging")
        }
        const under = document.elementsFromPoint(at.clientX, at.clientY).map(element => window_of(element)).find(found => found) ?? null
        mark(under, under ? zone_of(under.el, at.clientX, at.clientY) : "")
    }
    const end = (stop: Event): void => {
        removeEventListener("pointermove", move)
        removeEventListener("pointerup", end)
        removeEventListener("pointercancel", end)
        if (!dragging) return
        item.el.classList.remove("is_moving")
        document.documentElement.classList.remove("desk_dragging")
        const target = over
        const at = zone
        mark(null, "")
        // the release would also toggle the menu
        addEventListener("click", click => click.preventDefault(), { capture: true, once: true })
        if (!target || !at || stop.type === "pointercancel") return
        if (target === item) {
            if (at !== "swap") move_window(item, at)
        } else if (at === "swap") swap_windows(item, target)
        else dock_window(item, target, at)
    }
    addEventListener("pointermove", move)
    addEventListener("pointerup", end)
    addEventListener("pointercancel", end)
}

// ---- resizing -------------------------------------------------------------------------------------------------------------------
// A gap is a draggable div between two window tracks. Moving it trades weight between those two tracks, so the rest of the desk (and the side
// panel, which is the 1fr column) is not touched. Weights, not pixels, are kept: opening the side panel squeezes every window by the same ratio.

const min_track = 96

function resize_tracks(vertical: boolean, boundary: number, delta: number, start: number[] | null = null): void {
    const desk = state.desk
    if (!desk) return
    const weights = vertical ? col_weights : row_weights
    const sizes = (getComputedStyle(desk)[vertical ? "gridTemplateColumns" : "gridTemplateRows"]).split(" ").map(parseFloat)
    // window tracks: columns are at 2, 4, ... (after the side and the edge), rows at 0, 2, ...
    const first = (vertical ? 2 : 0) + 2 * boundary
    const a = start ? start[0] : sizes[first]
    const b = start ? start[1] : sizes[first + 2]
    if (!(a > 0) || !(b > 0)) return
    const total = a + b
    const floor = Math.min(min_track, total / 3)
    const next = Math.min(total - floor, Math.max(floor, a + delta))
    const pair = weights[boundary] + weights[boundary + 1]
    weights[boundary] = pair * next / total
    weights[boundary + 1] = pair - weights[boundary]
    apply_template(col_weights.length, row_weights.length)
}

function start_resize(event: PointerEvent): void {
    const gap = (event.target as Element).closest<HTMLElement>(".desk_gap")
    if (!gap || !state.desk || event.button !== 0) return
    event.preventDefault()
    const vertical = gap.dataset.axis === "col"
    const boundary = Number(gap.dataset.index)
    const sizes = getComputedStyle(state.desk)[vertical ? "gridTemplateColumns" : "gridTemplateRows"].split(" ").map(parseFloat)
    const first = (vertical ? 2 : 0) + 2 * boundary
    const start = [sizes[first], sizes[first + 2]]
    const origin = vertical ? event.clientX : event.clientY
    gap.classList.add("is_drag")
    gap.setPointerCapture(event.pointerId)
    document.documentElement.classList.add(vertical ? "desk_resizing_col" : "desk_resizing_row")
    const move = (at: PointerEvent): void => resize_tracks(vertical, boundary, (vertical ? at.clientX : at.clientY) - origin, start)
    const end = (): void => {
        gap.removeEventListener("pointermove", move)
        gap.removeEventListener("pointerup", end)
        gap.removeEventListener("pointercancel", end)
        gap.classList.remove("is_drag")
        document.documentElement.classList.remove("desk_resizing_col", "desk_resizing_row")
    }
    gap.addEventListener("pointermove", move)
    gap.addEventListener("pointerup", end)
    gap.addEventListener("pointercancel", end)
}

function key_resize(event: KeyboardEvent): void {
    const gap = (event.target as Element).closest<HTMLElement>(".desk_gap")
    if (!gap) return
    const vertical = gap.dataset.axis === "col"
    const step = event.shiftKey ? 80 : 20
    const keys: Record<string, number> = vertical ? { ArrowLeft: -step, ArrowRight: step } : { ArrowUp: -step, ArrowDown: step }
    if (!(event.key in keys)) return
    event.preventDefault()
    resize_tracks(vertical, Number(gap.dataset.index), keys[event.key])
}

// Closing removes the window completely: its element, its tab and whatever it held.
export function close_window(item: desk_window | null): void {
    if (!item) return
    const index = state.windows.indexOf(item)
    window_hooks.closed(item)
    item.el.remove()
    item.tab.remove()
    state.windows.splice(index, 1)
    if (state.maximized === item) state.maximized = null
    if (state.focused === item) state.focused = state.windows.filter(entry => !entry.minimized)[Math.max(0, index - 1)] ?? null
    arrange()
}

export function toggle_maximize(item: desk_window | null): void {
    if (!item) return
    if (state.maximized === item) state.maximized = null
    else {
        item.minimized = false
        state.maximized = item
    }
    state.focused = item
    arrange()
}

// Pressing a window's tab works like a Windows taskbar button:
//   - a minimized window comes back and takes focus,
//   - a shown window that is not the focused one takes focus (in portrait it is not in view yet, so it only switches the view),
//   - the focused window is minimized (in portrait that leaves no window in view).
// Maximize is the exception: pressing the maximized window's own tab restores it, and pressing another window's tab while one is
// maximized hands the full desk to the pressed window.
export function activate(item: desk_window): void {
    if (state.maximized) toggle_maximize(item)
    else if (item.minimized) focus_window(item)
    else if (state.focused === item) toggle_minimize(item)
    else focus_window(item)
}

export function init_desk(): void {
    dispose()
    const desk = document.querySelector<HTMLElement>(".desk[data-runtime]")
    if (!desk) return
    state.desk = desk
    state.data = read_data()
    state.next_id = 1
    restore_tabs()
    // A desk whose windows are all made by the runtime starts blank: it opens with one empty window (the first file opened fills it).
    if (state.windows.length === 0) new_window()
    arrange()
    init_fs(desk)
}

let bound = false

export function bind_desk(): void {
    if (bound) return
    bound = true
    init_view(new_window)
    init_proc()
    document.addEventListener("click", on_click)
    document.addEventListener("jazu:page", init_desk)
    portrait.addEventListener("change", () => arrange())
    document.addEventListener("pointerdown", start_drag)
    document.addEventListener("pointerdown", start_resize)
    document.addEventListener("keydown", key_resize)
    // A window's glass (backdrop-filter) makes it the containing block of the dropdowns' full-screen click-away layer, which is switched off
    // in the theme; a press outside an open list inside a window closes it here instead.
    document.addEventListener("pointerdown", event => {
        const inside = (event.target as Element).closest?.("details.list")
        for (const open of document.querySelectorAll<HTMLDetailsElement>(".desk_wbox details.list[open]")) {
            if (open !== inside && !(inside && open.contains(inside))) open.removeAttribute("open")
        }
    }, true)
    document.addEventListener("pointerdown", event => {
        const item = window_of(event.target as Element)
        if (item && state.desk) focus_window(item)
    }, true)
    init_desk()
}
