// The expertise slider is a scroll-snap track, and the page's whole state machine is CSS :target (dots, tabs, timeline highlight, filters).
// Swiping or scrolling the track moves the slides but not the :target, so the dots and the timeline stayed on the old slide. This watches
// the track, and once it settles on a slide it moves the fragment to that slide's pin, which the CSS already knows how to follow.

import { go_to, slide_id } from "./search.ts"

const default_state = "expertise"
// the CSS removes the slides' snap points for this long after every state change ($snap-time in default.scss); scrolling inside it is ours
const snap_time = 900

let quiet_until = 0
let timer = 0

function current_state(): string | null {
    const hash = decodeURIComponent(location.hash.slice(1))
    if (hash === "" || hash === "timeline") return hash === "" ? default_state : null
    if (hash.endsWith("/timeline")) return null
    const state = hash.split("/")[0]
    // a fragment that is not a state at all (#contact, #main-content ...): the slider shows the default state
    return document.getElementById(`${state}/timeline`) || state === default_state ? state : default_state
}

function visible(slide: HTMLElement): boolean {
    return slide.getClientRects().length > 0 && getComputedStyle(slide).visibility !== "hidden"
}

function centered_slide(track: HTMLElement): HTMLElement | null {
    const box = track.getBoundingClientRect()
    const middle = box.left + box.width / 2
    let best: HTMLElement | null = null
    let gap = Infinity
    for (const slide of track.querySelectorAll<HTMLElement>(":scope > .slide")) {
        if (!visible(slide)) continue
        const card = slide.getBoundingClientRect()
        const distance = Math.abs(card.left + card.width / 2 - middle)
        if (distance < gap) {
            gap = distance
            best = slide
        }
    }
    return best
}

function settle(track: HTMLElement): void {
    if (performance.now() < quiet_until) return
    // a search result list is not a state: the fragment must not be moved by scrolling it (client_search.ts follows the scroll itself)
    if (track.closest(".expertise.is_searching")) return
    const state = current_state()
    if (!state) return
    const slide = centered_slide(track)
    if (!slide) return
    const pin = [...slide.querySelectorAll<HTMLElement>(".pin")].find(item => item.id.startsWith(`${state}/`))
    if (!pin || location.hash === `#${pin.id}` || decodeURIComponent(location.hash) === `#${pin.id}`) return
    quiet_until = performance.now() + snap_time
    // replace, not assign: scrolling through slides must not fill the back button with entries
    location.replace(`#${pin.id}`)
}

// ---- the fixed Previous / Next pair ----
// They live outside the track, so they never travel with a slide. After every change of the slide in view they are pointed at the visible
// neighbours (filters and search results change who the neighbours are) and shown, or hidden when there is no neighbour on that side.

function nav_state(): string {
    const hash = decodeURIComponent(location.hash.slice(1))
    if (hash === "" || hash === "timeline") return default_state
    if (hash.endsWith("/timeline")) return hash.slice(0, -"/timeline".length)
    return current_state() ?? default_state
}

function visible_slides(track: HTMLElement): HTMLElement[] {
    return [...track.querySelectorAll<HTMLElement>(":scope > .slide")].filter(visible)
}

// Right after a click or a fragment change the track is still animating: the slide the fragment names is the one that is "in view"
function slide_in_view(track: HTMLElement): HTMLElement | null {
    if (performance.now() < quiet_until) {
        const hash = decodeURIComponent(location.hash.slice(1))
        const pin = hash ? document.getElementById(hash) : null
        const slide = pin?.closest<HTMLElement>(".slide")
        if (slide && slide.parentElement === track && visible(slide)) return slide
    }
    return centered_slide(track)
}

function point_nav(article: HTMLElement, link: HTMLAnchorElement, slide: HTMLElement | undefined): void {
    if (!slide) return hide_nav(link)
    const id = slide_id(slide)
    const name = slide.querySelector(".slide_name")?.textContent ?? id
    if (article.classList.contains("is_searching")) {
        link.href = `#search/${encodeURIComponent(id)}`
        link.dataset.go = id
    } else {
        const state = nav_state()
        const pin = [...slide.querySelectorAll<HTMLElement>(".pin")].find(item => item.id.startsWith(`${state}/`))
        if (!pin) return hide_nav(link)
        link.href = `#${pin.id}`
        delete link.dataset.go
    }
    link.setAttribute("aria-label", `${link.dataset.label ?? ""}: ${name}`)
    link.hidden = false
}

function hide_nav(link: HTMLAnchorElement): void {
    link.hidden = true
    link.removeAttribute("href")
    delete link.dataset.go
}

function update_nav(): void {
    const article = document.querySelector<HTMLElement>(".expertise")
    const track = article?.querySelector<HTMLElement>(".expertise_track")
    const prev = article?.querySelector<HTMLAnchorElement>(".expertise_nav .nav_prev")
    const next = article?.querySelector<HTMLAnchorElement>(".expertise_nav .nav_next")
    if (!article || !track || !prev || !next) return
    const slides = visible_slides(track)
    const current = slide_in_view(track)
    const index = current ? slides.indexOf(current) : -1
    if (index < 0) {
        hide_nav(prev)
        hide_nav(next)
        return
    }
    // the slides are in the order of the slider: the one after the current slide is "next"
    point_nav(article, prev, slides[index - 1])
    point_nav(article, next, slides[index + 1])
}

let nav_frame = 0
function schedule_nav(): void {
    if (nav_frame) return
    nav_frame = requestAnimationFrame(() => {
        nav_frame = 0
        update_nav()
    })
}

const watched = new WeakSet<Element>()
function watch_article(): void {
    const article = document.querySelector<HTMLElement>(".expertise")
    if (article && !watched.has(article)) {
        watched.add(article)
        // filters, the search (is_searching, hit) and the states change which slides are shown, always through a class
        new MutationObserver(schedule_nav).observe(article, { subtree: true, attributes: true, attributeFilter: ["class", "hidden"] })
    }
    schedule_nav()
}

function init_nav(): void {
    document.addEventListener("scroll", event => {
        const track = event.target
        if (track instanceof HTMLElement && track.matches(".expertise_track")) schedule_nav()
    }, { capture: true, passive: true })
    document.addEventListener("change", schedule_nav)
    addEventListener("resize", schedule_nav)
    addEventListener("hashchange", schedule_nav)
    document.addEventListener("jazu:page", watch_article)
    // a search result is not a state: its link moves the track itself (the fragment follows)
    document.addEventListener("click", event => {
        const mouse = event as MouseEvent
        const link = (event.target as HTMLElement).closest<HTMLAnchorElement>(".expertise_nav .arrow[data-go]")
        if (!link || mouse.button !== 0 || mouse.ctrlKey || mouse.metaKey || mouse.shiftKey) return
        const article = link.closest<HTMLElement>(".expertise")
        const id = link.dataset.go
        if (!article || !id) return
        event.preventDefault()
        go_to(article, id, true)
        if (decodeURIComponent(location.hash) !== `#search/${id}`) location.hash = `search/${encodeURIComponent(id)}`
    })
    watch_article()
}

export function init_expertise(): void {
    init_nav()
    // capture + document: scroll does not bubble, and a page swap (client_spa) replaces the track element
    document.addEventListener("scroll", event => {
        const track = event.target
        if (!(track instanceof HTMLElement) || !track.matches(".expertise_track")) return
        clearTimeout(timer)
        timer = window.setTimeout(() => settle(track), 140)
    }, { capture: true, passive: true })
    document.addEventListener("scrollend", event => {
        const track = event.target
        if (!(track instanceof HTMLElement) || !track.matches(".expertise_track")) return
        clearTimeout(timer)
        settle(track)
    }, true)
    // a hash that came from a click: the track is about to animate to the slide, do not read that as the reader scrolling
    addEventListener("hashchange", () => {
        quiet_until = Math.max(quiet_until, performance.now() + snap_time)
    })
}
