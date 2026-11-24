/** Conversion controls follow the selected child; settings persist with desktop groups. */
import { state, type desk_window } from "../index.ts"
import { set_mime } from "../action/resource.ts"
import { render_window } from "../window/index.ts"
import { converters } from "../conversion/index.ts"
import { route } from "../conversion/graph.ts"
export function init_conversion_menu(desk: HTMLElement): () => void {
    const side = desk.querySelector(".desk_side"), tabs = side?.querySelector(".desk_side_tabs_ul")
    if (!side || !tabs) return () => {}
    const abort = new AbortController(), tab = document.createElement("li"), toggle = document.createElement("details")
    toggle.className = "desk_side_tabs_drop"; toggle.name = "desk_side_tab"; toggle.dataset.path = "desk:conversion"
    const summary = document.createElement("summary"); summary.textContent = "Conversion"
    toggle.append(summary); tab.append(toggle); tabs.append(tab)
    const panel = document.createElement("div")
    panel.className = "desk_side_page desk_conversion_menu"; panel.dataset.path = "desk:conversion"; panel.hidden = true
    side.append(panel)
    let selected: desk_window | null = null, key = ""
    const draw = () => {
        const item = state.focused, child = item?.parent ? item : null
        tab.hidden = !child
        if (!child && toggle.open) { toggle.open = false; (tabs.querySelector("details") as HTMLDetailsElement | null)?.setAttribute("open", "") }
        const next = JSON.stringify([child?.id, child?.parent?.mime, child?.mime, child?.conversion])
        if (next === key && selected === child) return
        key = next; selected = child; panel.replaceChildren()
        if (!child) return
        const heading = document.createElement("h3"); heading.textContent = `window:${child.parent!.id} → window:${child.id}`
        const form = document.createElement("form"), label = document.createElement("label"), select = document.createElement("select")
        label.textContent = "Output MIME "; select.name = "mime"; select.setAttribute("aria-label", "Output MIME")
        const targets = [...new Set(converters.map(edge => edge.to))].filter(mime => route(converters, child.parent!.mime, mime))
        if (child.mime && !targets.includes(child.mime)) targets.unshift(child.mime)
        const blank = document.createElement("option"); blank.value = ""; blank.textContent = "Choose a format"; select.append(blank)
        for (const mime of targets) { const option = document.createElement("option"); option.value = option.textContent = mime; select.append(option) }
        select.value = child.mime; label.append(select); form.append(label)
        const path = route(converters, child.parent!.mime, child.mime), info = document.createElement("p")
        info.dataset.conversionRoute = ""
        info.textContent = !child.mime ? "Choose an output format." : path ? [child.parent!.mime, ...path.map(edge => edge.to)].join(" → ") : "No conversion route available."
        const fields = new Map(path?.flatMap(edge => edge.fields ?? []).map(field => [field.key, field]) ?? [])
        for (const field of fields.values()) {
            const label = document.createElement("label"), input = document.createElement("input")
            label.textContent = field.label + " "; input.name = field.key; input.type = field.type ?? "text"
            input.value = child.conversion?.[field.key] ?? field.value
            for (const attr of ["min", "max", "step"] as const) if (field[attr]) input.setAttribute(attr, field[attr])
            label.append(input); form.append(label, document.createElement("br"))
        }
        const apply = document.createElement("button"); apply.type = "submit"; apply.textContent = "Apply conversion"; apply.disabled = !child.mime || !path
        select.addEventListener("change", () => {
            child.picks.own = false
            set_mime(child, select.value)
        })
        form.addEventListener("submit", event => {
            event.preventDefault()
            child.conversion = Object.fromEntries([...new FormData(form)].filter(([key]) => key !== "mime").map(([key, value]) => [key, String(value)]))
            child.picks.own = false; child.picks.mime = true
            render_window(child)
        })
        form.append(apply); panel.append(heading, info, form)
    }
    const queue = () => queueMicrotask(() => { if (!abort.signal.aborted) draw() })
    document.addEventListener("jazu:desk:change", queue, { signal: abort.signal })
    draw()
    return () => { abort.abort(); panel.remove(); tab.remove() }
}
