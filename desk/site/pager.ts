// Slide pager. The dots (one radio-like dot per slide) stop being readable past 10 slides, so then they are replaced by a number
// input: the number of the slide that is showing, "|" and the total, in a rounded box: "(13|30)". It applies to every list (a skill, Featured,
// search results), and the numbers are always those of the slides that are shown right now, so they follow the filter chips and the search.
// Typing a number (or Enter, or the arrow keys of the field) goes to that slide.

import { go_to, slide_id } from "./search.ts"

const max_dots = 10

function shown_slides(article: HTMLElement): HTMLElement[] {
    return [...article.querySelectorAll<HTMLElement>(".expertise_track > .slide")].filter(slide => slide.getClientRects().length > 0)
}

function current_index(article: HTMLElement, slides: HTMLElement[]): number {
    const track = article.querySelector<HTMLElement>(".expertise_track")
    if (!track || slides.length === 0) return 0
    let best = 0
    let gap = Infinity
    slides.forEach((slide, index) => {
        const distance = Math.abs(slide.offsetLeft - track.scrollLeft)
        if (distance < gap) {
            gap = distance
            best = index
        }
    })
    return best
}

function pager_of(article: HTMLElement): HTMLElement | null {
    const dots = article.querySelector<HTMLElement>(".expertise_dots")
    if (!dots) return null
    let pager = dots.querySelector<HTMLElement>(".expertise_pager")
    if (pager) return pager
    pager = document.createElement("li")
    pager.className = "expertise_pager"
    pager.innerHTML = `<input class="pager_input" type="number" min="1" inputmode="numeric" aria-label="${(article.dataset.slide_number ?? "Slide number").replace(/"/g, "&quot;")}"><span class="pager_sep" aria-hidden="true">|</span><span class="pager_total"></span>`
    dots.append(pager)
    return pager
}

export function update_pager(article: HTMLElement): void {
    const dots = article.querySelector<HTMLElement>(".expertise_dots")
    if (!dots) return
    const slides = shown_slides(article)
    const paged = slides.length > max_dots
    dots.classList.toggle("is_paged", paged)
    if (!paged) return
    const pager = pager_of(article)!
    const input = pager.querySelector<HTMLInputElement>(".pager_input")!
    pager.querySelector<HTMLElement>(".pager_total")!.textContent = String(slides.length)
    input.max = String(slides.length)
    // the field is as wide as the total's digits, so "(3|30)" and "(13|30)" are the same size
    input.style.width = `${String(slides.length).length + 1}ch`
    // do not rewrite the number while it is being typed
    if (document.activeElement !== input) input.value = String(current_index(article, slides) + 1)
}

function goto_number(article: HTMLElement, wanted: number): void {
    const slides = shown_slides(article)
    if (slides.length === 0) return
    const slide = slides[Math.min(Math.max(Math.round(wanted), 1), slides.length) - 1]
    const id = slide_id(slide)
    if (article.classList.contains("is_searching")) {
        go_to(article, id, true)
        location.hash = `search/${encodeURIComponent(id)}`
        return
    }
    // the dot link of this slide that belongs to the current state (the others are .st-hidden): its fragment is the slide's :target
    const link = [...article.querySelectorAll<HTMLAnchorElement>(`.d_${CSS.escape(id)} .dot_a`)].find(item => getComputedStyle(item).visibility === "visible")
    if (link) location.hash = new URL(link.href).hash.slice(1)
    else slide.parentElement?.scrollTo({ left: slide.offsetLeft, behavior: "smooth" })
}

function refresh_all(): void {
    for (const article of document.querySelectorAll<HTMLElement>(".expertise")) update_pager(article)
}

// the CSS has switched the slides by the time the next frame is drawn; the track settles later, so look again after it
function refresh_soon(): void {
    requestAnimationFrame(refresh_all)
    setTimeout(refresh_all, 250)
    setTimeout(refresh_all, 1000)
}

export function init_pager(): void {
    refresh_soon()
    addEventListener("hashchange", refresh_soon)
    document.addEventListener("change", event => {
        const target = event.target as HTMLElement
        if (target.matches?.(".pager_input")) {
            const article = target.closest<HTMLElement>(".expertise")
            if (article) goto_number(article, Number((target as HTMLInputElement).value))
            return
        }
        refresh_soon()
    })
    document.addEventListener("input", event => {
        const target = event.target as HTMLElement
        // search keystrokes and the field itself: the list changes at once
        if (target.matches?.(".expertise_search_input")) refresh_soon()
    })
    document.addEventListener("keydown", event => {
        const target = event.target as HTMLInputElement
        if (!target.matches?.(".pager_input") || event.key !== "Enter") return
        event.preventDefault()
        const article = target.closest<HTMLElement>(".expertise")
        if (article) goto_number(article, Number(target.value))
        target.blur()
    })
    document.addEventListener("click", event => {
        if ((event.target as HTMLElement).closest?.(".chip, .chip_all, .tab a, .expertise_search_btn, a[href^=\"#\"]")) refresh_soon()
    })
    document.addEventListener("scroll", event => {
        const track = event.target
        if (!(track instanceof HTMLElement) || !track.matches(".expertise_track")) return
        const article = track.closest<HTMLElement>(".expertise")
        if (article) update_pager(article)
    }, { capture: true, passive: true })
    document.addEventListener("jazu:page", refresh_soon)
}
