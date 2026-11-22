export function filter_list(input: HTMLInputElement): void {
    const drop = input.closest(".list_drop")!
    const query = input.value.trim().toLowerCase()
    let hits = 0
    for (const item of drop.querySelectorAll<HTMLElement>(".list_drop_li")) {
        const hit = !query || (item.textContent ?? "").toLowerCase().includes(query)
        item.hidden = !hit
        if (hit) hits++
    }
    const empty = drop.querySelector<HTMLElement>(".list_drop_empty")
    if (empty) empty.hidden = hits > 0
}

export function init_filters(): void {
    document.addEventListener("input", event => {
        const input = event.target as HTMLElement
        if (input.matches(".list_drop_search input")) filter_list(input as HTMLInputElement)
    })
    document.addEventListener("keydown", event => {
        const target = event.target as HTMLElement
        if (event.key === "Escape") close_open_lists(target)
        if (event.key !== "Enter" || !target.matches(".list_drop_search input")) return
        event.preventDefault()
        target.closest(".list_drop")!.querySelector<HTMLElement>(".list_drop_li:not([hidden]) a")?.click()
    })
    document.addEventListener("toggle", event => {
        const details = event.target as HTMLDetailsElement
        const input = details.matches?.("details.list:not([open])") && details.querySelector<HTMLInputElement>(".list_drop_search input")
        if (input && input.value) {
            input.value = ""
            filter_list(input)
        }
    }, true)
}

function close_open_lists(target: HTMLElement): void {
    const open = target.closest<HTMLDetailsElement>("details.list[open]") ?? document.querySelector<HTMLDetailsElement>("details.list[open]")
    if (!open) return
    open.open = false
    open.querySelector<HTMLElement>("summary")?.focus()
}

// navigator.clipboard only exists in a secure context (https / localhost) and can be refused; the selection + execCommand path
// still works on a plain http preview and in older browsers, so the button never silently does nothing.
async function copy_text(text: string): Promise<boolean> {
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text)
            return true
        }
    } catch { /* fall through to the selection fallback */ }
    const area = document.createElement("textarea")
    area.value = text
    area.setAttribute("readonly", "")
    area.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none"
    document.body.append(area)
    area.select()
    area.setSelectionRange(0, text.length)
    let ok = false
    try {
        ok = document.execCommand("copy")
    } catch { /* ok stays false */ }
    area.remove()
    return ok
}

const copy_timers = new WeakMap<HTMLElement, number>()

export function init_copy(): void {
    document.addEventListener("click", async event => {
        const button = (event.target as HTMLElement).closest<HTMLElement>("[data-copy]")
        if (!button) return
        const status = document.getElementById("contact_status")
        const label = button.querySelector<HTMLElement>("span")
        const idle = label?.dataset.idle ?? label?.textContent ?? ""
        if (label) label.dataset.idle = idle
        const ok = await copy_text(button.dataset.copy ?? "")
        const message = (ok ? button.dataset.copied : button.dataset.copy_failed) ?? ""
        // visible feedback on the button itself, plus the live region for screen readers
        if (label) label.textContent = message
        button.classList.toggle("copied", ok)
        if (status) status.textContent = ok ? `${message} ${button.dataset.copy}` : message
        clearTimeout(copy_timers.get(button))
        copy_timers.set(button, window.setTimeout(() => {
            if (label) label.textContent = idle
            button.classList.remove("copied")
            if (status) status.textContent = ""
        }, 2000))
    })
}

export function init_chips(): void {
    const chips = (set: Element): HTMLInputElement[] => [...set.querySelectorAll<HTMLInputElement>(".chk")]
    const sync = (set: Element): void => {
        set.querySelector(".chip_all")?.setAttribute("aria-pressed", String(chips(set).every(chip => chip.checked)))
    }
    document.addEventListener("click", event => {
        const all = (event.target as HTMLElement).closest(".chip_all")
        if (!all) return
        const set = all.closest(".stackset")!
        const on = !chips(set).every(chip => chip.checked)
        for (const chip of chips(set)) chip.checked = on
        sync(set)
    })
    document.addEventListener("change", event => {
        const target = event.target as HTMLElement
        const set = target.closest?.(".stackset")
        if (set && target.matches(".chk")) sync(set)
    })
}

export function init_live_time(): void {
    const update = (): void => {
        for (const node of document.querySelectorAll<HTMLTimeElement>("[data-live-time]")) {
            const zone = node.dataset.tz || undefined
            const now = new Date()
            node.textContent = new Intl.DateTimeFormat(document.documentElement.lang || "en", { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(now)
            node.dateTime = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hour12: false }).format(now)
        }
    }
    update()
    setInterval(update, 30000)
}

// The header is server-rendered with the site's default theme and mode checked, and a page swap re-renders it, so after the stored choice
// (or a swap) the radios are brought back in line with what <html> says is active.
export function sync_theme_radios(): void {
    const root = document.documentElement
    const theme = document.getElementById(`theme_name_${root.dataset.theme}`) as HTMLInputElement | null
    const mode = document.getElementById(`theme_state_${root.dataset.mode}`) as HTMLInputElement | null
    if (theme) theme.checked = true
    if (mode) mode.checked = true
}
