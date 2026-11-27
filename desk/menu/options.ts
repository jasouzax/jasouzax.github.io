/** One options strip per menu, outside the entries feed at the bottom of the side. */
import { state } from "../index.ts"
export function option_button(label: string, icon: string, run?: () => void): HTMLButtonElement {
    const button = document.createElement("button"); button.type = "button"; button.title = label
    const glyph = document.createElement("span"); glyph.className = "desk_files_icon"; glyph.setAttribute("aria-hidden", "true")
    glyph.textContent = state.data?.icons?.[icon] || state.data?.icons?.window || ""
    const caption = document.createElement("span"); caption.textContent = label
    button.append(glyph, caption); if (run) button.addEventListener("click", run)
    return button
}
export function option_group(label: string, ...buttons: HTMLElement[]): HTMLElement {
    const group = document.createElement("div"); group.className = "desk_option_group"
    const caption = document.createElement("span"); caption.className = "desk_option_caption"; caption.textContent = label || "\u00a0"
    caption.toggleAttribute("data-empty", !label)
    const row = document.createElement("div"); row.className = "desk_option_buttons"; row.append(...buttons)
    group.append(caption, row); return group
}
export function mount_options(page: HTMLElement, bar: HTMLElement): () => void {
    const side = page.closest<HTMLElement>(".desk_side")!
    for (const previous of side.querySelectorAll<HTMLElement>(":scope > [data-options-for]")) if (previous.dataset.optionsFor === (page.dataset.path || "")) previous.remove()
    bar.classList.add("desk_menu_options"); bar.dataset.optionsFor = page.dataset.path || ""
    bar.setAttribute("role", "toolbar"); bar.setAttribute("aria-label", "Options")
    side.append(bar)
    const sync = () => {
        const active = side.querySelector<HTMLDetailsElement>(".desk_side_tabs_drop[open]")
        bar.hidden = active?.dataset.path !== page.dataset.path
    }
    const controller = new AbortController()
    side.addEventListener("toggle", sync, { capture: true, signal: controller.signal })
    sync()
    return () => { controller.abort(); bar.remove() }
}

export function init_menu_options(desk: HTMLElement): () => void {
    const releases: (() => void)[] = []
    const scan = () => {
        for (const page of desk.querySelectorAll<HTMLElement>(".desk_side_page")) {
            if ([...desk.querySelectorAll<HTMLElement>("[data-options-for]")].some(bar => bar.dataset.optionsFor === (page.dataset.path || ""))) continue
            const bar = document.createElement("div"), row = document.createElement("div")
            row.className = "desk_files_buttons"
            const foot = page.querySelector<HTMLElement>(":scope > .desk_menu_foot")
            if (foot) { row.append(option_group("", ...[...foot.children] as HTMLElement[])); foot.remove() }
            bar.append(row); releases.push(mount_options(page, bar))
        }
    }
    const observer = new MutationObserver(scan)
    observer.observe(desk.querySelector(".desk_side")!, { childList: true })
    scan()
    return () => { observer.disconnect(); releases.forEach(release => release()) }
}
