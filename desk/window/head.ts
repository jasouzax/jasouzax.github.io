import type { desk_window } from "../index.ts"

export function head_part<element extends HTMLElement>(item: desk_window, selector: string): element | null {
    return item.el.querySelector<element>(`.desk_wbox_head ${selector}`)
}
