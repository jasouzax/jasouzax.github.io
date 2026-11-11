/*
 * Flow rules: which relation a split child has to its parent, decided from what the user has picked in the child. Pure: no DOM, no state.
 *
 * Entities
 *   Child_Picks   what the user chose in the child itself: a type, a mode, a resource of its own. Everything false is the empty child.
 *   flow_of       Child_Picks -> Flow_Kind | "" ("" while the child is still empty)
 *
 * Limits
 *   An own resource beats a picked type, and a picked type beats a picked mode, so the child always has exactly one flow.
 *   Choosing the case that serves a flow is plugin_types.ts; drawing its body is desk_view.ts.
 */
import type { Flow_Kind } from "../../plugin_types.ts"

export type Child_Picks = { mime: boolean, mode: boolean, own: boolean }

export function no_picks(): Child_Picks {
    return { mime: false, mode: false, own: false }
}

export function flow_of(picks: Child_Picks): Flow_Kind | "" {
    if (picks.own) return "compare"
    if (picks.mime) return "convert"
    return picks.mode ? "mirror" : ""
}
