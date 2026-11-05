// Expertise search. The field itself is a checkbox-driven (CSS only) reveal; this adds the behaviour around it:
//  - focus goes to the field when the search is opened
//  - every keystroke filters the timeline, the dots and the slides (all of them: skills, experience, education, projects, events...), client side
//  - the match is fuzzy, so a misspelt word still finds its entry
//  - "?search=query" in the URL opens the search, fills the field and filters, and moves to #expertise (a timeline hash is kept so the query
//    can be seen on the timeline)
// While a query is active the article gets .is_searching and every matching item gets .hit; default.scss shows exactly those (the
// state machine's own show/hide rules are overridden there), so the skill / slide fragment does not limit what is found.

type doc = { text: string[], items: HTMLElement[] }

function input_of(toggle: HTMLElement): HTMLInputElement | null {
    return toggle.closest(".expertise_search")?.querySelector<HTMLInputElement>(".expertise_search_input") ?? null
}

// Opening the search puts the caret in the field. Done after the click has finished: a click on the label hands focus to the checkbox
// as its last step, which would otherwise take it straight back from the field.
export function focus_search_input(toggle: HTMLElement): void {
    const input = input_of(toggle)
    if (!input) return
    requestAnimationFrame(() => input.focus({ preventScroll: true }))
}

function words(text: string): string[] {
    return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z0-9+#]+/).filter(Boolean)
}

// Levenshtein distance, cut off as soon as it must exceed the limit
function distance(a: string, b: string, limit: number): number {
    if (Math.abs(a.length - b.length) > limit) return limit + 1
    let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
    for (let i = 1; i <= a.length; i++) {
        const row = [i]
        let best = i
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1
            const value = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + cost)
            row[j] = value
            if (value < best) best = value
        }
        if (best > limit) return limit + 1
        previous = row
    }
    return previous[b.length]
}

function token_matches(token: string, text: string[]): boolean {
    const allowed = token.length <= 3 ? 0 : token.length <= 6 ? 1 : 2
    for (const word of text) {
        if (word.includes(token)) return true
        if (allowed === 0) continue
        // a typo inside the word, or inside the start of a longer word (typing "kubernet")
        if (distance(token, word, allowed) <= allowed) return true
        if (word.length > token.length && distance(token, word.slice(0, token.length), allowed) <= allowed) return true
    }
    return false
}

export function slide_id(slide: HTMLElement): string {
    const pin = slide.querySelector<HTMLElement>(".pin")
    return pin ? pin.id.slice(pin.id.indexOf("/") + 1) : ""
}

// The index is read from the page once per article (the markup does not change; a page swap brings a new article element)
const indexes = new WeakMap<HTMLElement, doc[]>()

function build_index(article: HTMLElement): doc[] {
    const found: doc[] = []
    const slide_docs = new Map<string, doc>()
    for (const slide of article.querySelectorAll<HTMLElement>(".slide")) {
        const id = slide_id(slide)
        if (!id) continue
        const entry: doc = { text: words(slide.textContent ?? ""), items: [slide] }
        for (const part of article.querySelectorAll<HTMLElement>(`.d_${CSS.escape(id)}, .p_${CSS.escape(id)}`)) entry.items.push(part)
        slide_docs.set(id, entry)
        found.push(entry)
    }
    // experience / education bars (the timeline pins of projects and events are already covered by their slide)
    for (const bar of article.querySelectorAll<HTMLElement>(".tl_bar")) {
        found.push({ text: words(bar.textContent ?? ""), items: [bar] })
    }
    return found
}

// ---- search links ----
// The timeline chips, the dots and the previous / next arrows are generated for a skill tab or the featured list: each link is tied to a
// state (.st), and only the current state's links are shown or clickable. A search result belongs to no state, so while a query is active
// these are replaced by links installed here (no .st), one set per matching slide, in the order of the results.

function hit_slides(article: HTMLElement): HTMLElement[] {
    return [...article.querySelectorAll<HTMLElement>(".slide.hit")]
}

// A fragment navigation (the search pins, back to #expertise) takes focus off the field that is being typed in. That happens exactly when the
// first character is typed (the page moves onto #search/...) and when the field is emptied (it moves back), so focus is handed back.
function move_to_hash(hash: string): void {
    const active = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement ? document.activeElement : null
    const start = active?.selectionStart ?? null
    const end = active?.selectionEnd ?? null
    location.replace(hash)
    if (!active) return
    const restore = (): void => {
        if (!active.isConnected || document.activeElement === active) return
        active.focus({ preventScroll: true })
        if (start !== null && end !== null) active.setSelectionRange(start, end)
    }
    restore()
    requestAnimationFrame(restore)
}

function clear_links(article: HTMLElement): void {
    for (const link of article.querySelectorAll(".search_link")) link.remove()
    for (const item of article.querySelectorAll(".search_current")) item.classList.remove("search_current")
}

function make_link(article: HTMLElement, query: string, id: string, label: string, classes: string, html: string): HTMLAnchorElement {
    const link = document.createElement("a")
    link.className = `${classes} search_link`
    // a real address, so "open in new tab" and copy link keep working; #search/<id> is the pin created below for this result
    link.href = `${location.pathname}?search=${encodeURIComponent(query.trim())}#search/${encodeURIComponent(id)}`
    link.dataset.searchGo = id
    link.setAttribute("aria-label", label)
    link.innerHTML = html
    return link
}

// The fragment of a search result is "#search/<slide id>". The pin with that id exists only while the result list does (it is created
// with the links and removed with them), and being the :target it replaces whatever skill / slide fragment the page was on, so the
// generated state rules (which only know the skill and slide ids) no longer apply and cannot highlight a slide that is not a result.
function result_hash_id(): string | null {
    const hash = decodeURIComponent(location.hash.slice(1))
    return hash.startsWith("search/") ? hash.slice(7) : null
}

function set_current(article: HTMLElement, id: string): void {
    for (const item of article.querySelectorAll(".search_current")) item.classList.remove("search_current")
    const safe = CSS.escape(id)
    for (const item of article.querySelectorAll<HTMLElement>(`.d_${safe}, .p_${safe}`)) item.classList.add("search_current")
    for (const slide of hit_slides(article)) if (slide_id(slide) === id) slide.classList.add("search_current")
}

export function go_to(article: HTMLElement, id: string, smooth: boolean): void {
    const slide = hit_slides(article).find(item => slide_id(item) === id)
    const track = article.querySelector<HTMLElement>(".expertise_track")
    if (!slide || !track) return
    track.scrollTo({ left: slide.offsetLeft, behavior: smooth ? "smooth" : "auto" })
    set_current(article, id)
}

function install_links(article: HTMLElement, query: string): void {
    clear_links(article)
    const slides = hit_slides(article)
    for (const slide of slides) {
        const id = slide_id(slide)
        const name = slide.querySelector(".slide_name")?.textContent ?? id
        const safe = CSS.escape(id)
        const pin = document.createElement("i")
        pin.className = "pin search_link"
        pin.id = `search/${id}`
        slide.prepend(pin)
        // arrows: the same two per slide as the generated ones (each sits beside its own slide and is revealed while the neighbour is shown)
        const next_label = `${slide.querySelector(".arrow_next")?.getAttribute("aria-label")?.split(":")[0] ?? "Next"}: ${name}`
        const prev_label = `${slide.querySelector(".arrow_prev")?.getAttribute("aria-label")?.split(":")[0] ?? "Previous"}: ${name}`
        const next_glyph = slide.querySelector(".arrow_next")?.innerHTML ?? "Next"
        const prev_glyph = slide.querySelector(".arrow_prev")?.innerHTML ?? "Previous"
        if (slide !== slides[0]) slide.append(make_link(article, query, id, next_label, "arrow arrow_next", next_glyph))
        if (slide !== slides[slides.length - 1]) slide.append(make_link(article, query, id, prev_label, "arrow arrow_prev", prev_glyph))
        // the radio dot
        for (const dot of article.querySelectorAll<HTMLElement>(`.dot.d_${safe}`)) dot.append(make_link(article, query, id, name, "dot_a", ""))
        // the timeline chip: the link covers the whole card
        for (const card of article.querySelectorAll<HTMLElement>(`.tl_pin.p_${safe} .tl_card`)) card.append(make_link(article, query, id, name, "tl_go", ""))
    }
    if (slides.length === 0) return
    const ids = slides.map(slide_id)
    const current = result_hash_id()
    if (current && ids.includes(current)) {
        set_current(article, current)
    } else {
        set_current(article, ids[0])
        // off the skill / slide fragment the search started on (a timeline fragment is kept: the query is shown there)
        if (!is_timeline_hash(location.hash)) move_to_hash(`#search/${encodeURIComponent(ids[0])}`)
    }
}

function apply(article: HTMLElement, query: string, keep_hash?: boolean): void {
    const input = article.querySelector<HTMLInputElement>(".expertise_search_input")
    const tokens = words(query)
    for (const item of article.querySelectorAll(".hit")) item.classList.remove("hit")
    clear_links(article)
    const empty = article.querySelector<HTMLElement>(".expertise_empty_search")
    if (tokens.length === 0) {
        article.classList.remove("is_searching")
        if (empty) empty.hidden = true
        // the search pins are gone: leave their fragment, or the page would sit on an id that no longer exists
        if (result_hash_id() !== null && keep_hash !== true) move_to_hash("#expertise")
        return
    }
    let index = indexes.get(article)
    if (!index) {
        index = build_index(article)
        indexes.set(article, index)
    }
    let hits = 0
    for (const entry of index) {
        if (!tokens.every(token => token_matches(token, entry.text))) continue
        hits++
        for (const item of entry.items) item.classList.add("hit")
    }
    article.classList.add("is_searching")
    if (empty) {
        empty.hidden = hits > 0
        const shown = empty.querySelector<HTMLElement>(".empty_q")
        if (shown) shown.textContent = query.trim()
    }
    install_links(article, query)
    // the first match comes into view
    const track = article.querySelector<HTMLElement>(".expertise_track")
    if (track) track.scrollTo({ left: 0 })
    if (input) input.setAttribute("aria-busy", "false")
}

function sync_url(query: string): void {
    const url = new URL(location.href)
    if (query.trim()) url.searchParams.set("search", query.trim())
    else url.searchParams.delete("search")
    history.replaceState(null, "", url)
}

function is_timeline_hash(hash: string): boolean {
    const value = decodeURIComponent(hash.replace(/^#/, ""))
    return value === "timeline" || value.endsWith("/timeline")
}

// "?search=" in the address: open the search, put the query in the field, filter, and focus the expertise element
function open_from_url(): void {
    const query = new URL(location.href).searchParams.get("search")
    if (query === null) return
    const article = document.querySelector<HTMLElement>(".expertise")
    const toggle = article?.querySelector<HTMLInputElement>(".expertise_search_tog")
    const input = article?.querySelector<HTMLInputElement>(".expertise_search_input")
    if (!article || !toggle || !input) return
    toggle.checked = true
    input.value = query
    apply(article, query)
    const wanted = result_hash_id()
    if (wanted) {
        // the link of a result: its pin exists now, so the fragment can target it
        requestAnimationFrame(() => go_to(article, wanted, false))
    } else if (!is_timeline_hash(location.hash) && location.hash !== "#expertise") {
        // another slide's or skill's fragment would hide the results: go to #expertise; the timeline fragment stays so the query shows there
        history.replaceState(null, "", `${location.pathname}${location.search}#expertise`)
        article.scrollIntoView()
    }
}

export function init_search(): void {
    document.addEventListener("change", event => {
        const toggle = event.target as HTMLInputElement
        if (!toggle.matches?.(".expertise_search_tog")) return
        const article = toggle.closest<HTMLElement>(".expertise")
        if (toggle.checked) {
            focus_search_input(toggle)
            const input = input_of(toggle)
            if (article && input?.value) apply(article, input.value)
        } else if (article) {
            // closing the search ends it: the page goes back to the skill that was selected
            apply(article, "")
            sync_url("")
        }
    })
    // a skill tab ends the search: the field is emptied and "?search=" leaves the address (the click's own navigation carries on to the skill).
    // The default theme hides the tabs while the search is open, but other themes (Memory) keep them visible, so this has to be handled.
    document.addEventListener("click", event => {
        const mouse = event as MouseEvent
        const tab = (event.target as HTMLElement).closest<HTMLElement>(".expertise_tabs a")
        if (!tab || mouse.button !== 0 || mouse.ctrlKey || mouse.metaKey || mouse.shiftKey) return
        const article = tab.closest<HTMLElement>(".expertise")
        const input = article?.querySelector<HTMLInputElement>(".expertise_search_input")
        if (!article || !input) return
        const searching = input.value !== "" || article.classList.contains("is_searching") || new URL(location.href).searchParams.has("search")
        if (!searching) return
        input.value = ""
        apply(article, "", true)
        sync_url("")
    })
    // Memory keeps the field open all the time, so there its x only empties the field (the default theme's x closes the search instead)
    document.addEventListener("click", event => {
        const button = (event.target as HTMLElement).closest<HTMLElement>(".expertise_search_btn")
        if (!button || document.documentElement.dataset.theme !== "memory") return
        const article = button.closest<HTMLElement>(".expertise")
        const input = article?.querySelector<HTMLInputElement>(".expertise_search_input")
        if (!article || !input) return
        event.preventDefault()
        input.value = ""
        apply(article, "")
        sync_url("")
        input.focus({ preventScroll: true })
    })
    // every keystroke (the search is client side)
    document.addEventListener("input", event => {
        const input = event.target as HTMLInputElement
        if (!input.matches?.(".expertise_search_input")) return
        const article = input.closest<HTMLElement>(".expertise")
        if (!article) return
        apply(article, input.value)
        sync_url(input.value)
    })
    // the form is a plain GET form for when there is no script; with script, Enter just keeps the live result
    document.addEventListener("submit", event => {
        const form = event.target as HTMLElement
        if (!form.matches?.(".expertise_search")) return
        event.preventDefault()
        const input = form.querySelector<HTMLInputElement>(".expertise_search_input")
        const article = form.closest<HTMLElement>(".expertise")
        if (input && article) {
            apply(article, input.value)
            sync_url(input.value)
        }
    })
    // a search link: go to that slide (no hash, no state: the generated :target machinery is not involved)
    document.addEventListener("click", event => {
        const link = (event.target as HTMLElement).closest<HTMLElement>("a.search_link")
        if (!link || (event as MouseEvent).button !== 0 || (event as MouseEvent).ctrlKey || (event as MouseEvent).metaKey || (event as MouseEvent).shiftKey) return
        const article = link.closest<HTMLElement>(".expertise")
        if (!article) return
        event.preventDefault()
        const id = link.dataset.searchGo ?? ""
        go_to(article, id, true)
        // the fragment follows (history entry per click, like the generated links), which also re-targets the pin
        if (result_hash_id() !== id) location.hash = `search/${encodeURIComponent(id)}`
    })
    // swiping the track moves the current mark with it
    let timer = 0
    document.addEventListener("scroll", event => {
        const track = event.target
        if (!(track instanceof HTMLElement) || !track.matches(".expertise_track")) return
        const article = track.closest<HTMLElement>(".expertise.is_searching")
        if (!article) return
        clearTimeout(timer)
        timer = window.setTimeout(() => {
            let best: HTMLElement | null = null
            let gap = Infinity
            for (const slide of hit_slides(article)) {
                const distance = Math.abs(slide.offsetLeft - track.scrollLeft)
                if (distance < gap) {
                    gap = distance
                    best = slide
                }
            }
            if (best) set_current(article, slide_id(best))
        }, 120)
    }, { capture: true, passive: true })
    // An experience / education bar in the results: the search is over. The field is emptied, the search area closes, and the page goes where
    // the bar's own link points (the click itself carries on to that fragment) with focus on the selected experience.
    document.addEventListener("click", event => {
        const mouse = event as MouseEvent
        const link = (event.target as HTMLElement).closest<HTMLAnchorElement>("a.tl_card:not(.search_link)")
        if (!link || mouse.button !== 0 || mouse.ctrlKey || mouse.metaKey || mouse.shiftKey) return
        const article = link.closest<HTMLElement>(".expertise.is_searching")
        if (!article) return
        const href = link.getAttribute("href") ?? ""
        const toggle = article.querySelector<HTMLInputElement>(".expertise_search_tog")
        const input = article.querySelector<HTMLInputElement>(".expertise_search_input")
        if (input) input.value = ""
        if (toggle) toggle.checked = false
        apply(article, "", true)
        sync_url("")
        const focus_selected = (): void => {
            const cards = [...document.querySelectorAll<HTMLAnchorElement>(`.expertise a.tl_card[href="${CSS.escape(href)}"]`)]
            const card = cards.find(item => getComputedStyle(item).visibility === "visible" && item.getClientRects().length > 0) ?? cards[0]
            card?.focus({ preventScroll: true })
        }
        // after the click's own navigation has been drawn
        requestAnimationFrame(focus_selected)
        setTimeout(focus_selected, 350)
    })
    addEventListener("hashchange", () => {
        const id = result_hash_id()
        const article = document.querySelector<HTMLElement>(".expertise.is_searching")
        if (id && article) go_to(article, id, true)
    })
    document.addEventListener("jazu:page", open_from_url)
    open_from_url()
}
