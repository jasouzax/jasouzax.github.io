import { init_reveal, update_tab_spy } from "./scroll.ts"
import { sync_theme_radios } from "./menus.ts"
import { deserialize, to_dom, type serialized_node } from "../vnode.tsx"
import { begin_loading, finish_loading, cancel_page_loading, wait_resources, wipe_page, page_signature, motion_reduced } from "./loading.ts"

type page_payload = {
    path: string
    lang?: string
    loading?: string
    title: string
    header: serialized_node
    main: serialized_node
    footer?: serialized_node
    body_class: string
    styles?: { href: string, media: string }[]
    dir?: string
    head?: serialized_node
}

export function should_intercept(event: MouseEvent, link: HTMLAnchorElement): boolean {
    if (event.defaultPrevented) return false
    if (event.button !== 0) return false
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false
    if (link.target && link.target !== "_self") return false
    if (link.hasAttribute("download")) return false
    if (!/^https?:$/.test(link.protocol)) return false
    if (link.origin !== location.origin) return false
    // files (pdf, images, the .json payloads themselves) are real downloads, not pages
    if (/\.[a-z0-9]{2,5}$/i.test(link.pathname) && !/\.html$/i.test(link.pathname)) return false
    if (/^\/(?:api|work)(?:\/|$)/.test(link.pathname)) return false
    return !(link.pathname === location.pathname && link.search === location.search && (link.hash || link.href.endsWith("#")))
}

export function json_url(url: URL): string {
    const path = url.pathname.replace(/\/index\.html$/i, "/").replace(/\.html$/i, "").replace(/\/$/, "")
    return `${path}/index.json${url.search}`
}

async function fetch_payload(url: URL, controller: AbortController): Promise<page_payload | null> {
    const timer = setTimeout(() => controller.abort(), 15000)
    try {
        const response = await fetch(json_url(url), { signal: controller.signal })
        if (!response.ok) return null
        const payload = await response.json() as page_payload
        return typeof payload.title === "string" && typeof payload.body_class === "string" &&
            Array.isArray(payload.header) && Array.isArray(payload.main) ? payload : null
    } catch {
        return null
    } finally {
        clearTimeout(timer)
    }
}

function announce(title: string): void {
    let region = document.getElementById("spa_live")
    if (!region) {
        region = document.createElement("div")
        region.id = "spa_live"
        region.className = "visually_hidden"
        region.setAttribute("aria-live", "polite")
        document.body.append(region)
    }
    region.textContent = title
}

function swap_page_styles(styles: { href: string, media: string }[]): Promise<unknown[]> {
    const current = [...document.head.querySelectorAll<HTMLLinkElement>("link[data-page-css]")]
    const pending: Promise<void>[] = []
    for (const link of current) {
        if (!styles.some(style => link.getAttribute("href") === style.href)) link.remove()
    }
    for (const style of styles) {
        if (current.some(link => link.getAttribute("href") === style.href)) continue
        const link = document.createElement("link")
        link.rel = "stylesheet"
        link.href = style.href
        if (style.media) link.media = style.media
        link.dataset.pageCss = ""
        pending.push(new Promise<void>(done => {
            link.onload = () => done()
            link.onerror = () => done()
            setTimeout(done, 4000)
        }))
        document.head.append(link)
    }
    return Promise.all(pending)
}

function swap_header(tree: serialized_node): void {
    const header = document.getElementById("head")!
    const signature = document.getElementById("head_signature")!
    const tray = document.getElementById("head_tray")!
    const next = to_dom(deserialize(tree)) as HTMLElement
    // Keep the SVG attached to the same header. Moving it into a replacement
    // header would restart the signature's SMIL timeline in some browsers.
    for (const child of Array.from(header.childNodes)) if (child !== signature && child !== tray) child.remove()
    let before_signature = true
    for (const child of Array.from(next.childNodes)) {
        if (child instanceof HTMLElement && child.id === "head_signature") {
            for (const attr of Array.from(child.attributes)) signature.setAttribute(attr.name, attr.value)
            before_signature = false
        } else if (child instanceof HTMLElement && child.id === "head_tray") {
            tray.replaceChildren(...Array.from(child.childNodes))
            header.append(tray)
        } else if (before_signature) header.insertBefore(child, signature)
        else header.append(child)
    }
}

function swap_page(payload: page_payload): Promise<unknown[]> {
    document.title = payload.title
    // switching language swaps the page without a reload: keep <html lang> (fonts, hyphenation, screen readers) and the spinner label in step
    if (payload.loading) document.documentElement.dataset.loading = payload.loading
    if (payload.lang) document.documentElement.lang = payload.lang
    if (payload.dir) document.documentElement.dir = payload.dir
    // description, canonical, hreflang, Open Graph, Twitter and JSON-LD carry data-seo: swap exactly those so a shared or bookmarked URL stays accurate
    if (payload.head !== undefined) {
        for (const node of document.head.querySelectorAll("[data-seo]")) node.remove()
        document.head.append(to_dom(deserialize(payload.head)))
    }
    document.body.className = payload.body_class
    const styles = swap_page_styles(payload.styles ?? [])
    swap_header(payload.header)
    document.getElementById("main-content")!.replaceChildren(to_dom(deserialize(payload.main)))
    if (payload.footer !== undefined) document.querySelector(".site_foot")?.replaceWith(to_dom(deserialize(payload.footer)))
    sync_theme_radios()
    document.dispatchEvent(new Event("jazu:page"))
    return styles
}

let current_path = location.pathname + location.search

// Search edits the current page's query without replacing its DOM. Keep the
// router in sync so the next fragment navigation does not reload that page.
export function replace_page_url(url: URL): void {
    history.replaceState(history.state, "", url)
    current_path = url.pathname + url.search
}

function scroll_to_hash(hash: string): void {
    let id = hash.slice(1)
    try { id = decodeURIComponent(id) } catch { /* malformed fragments remain literal IDs */ }
    const target = id ? document.getElementById(id) : null
    if (target) target.scrollIntoView({ behavior: "instant" })
    else scrollTo({ left: 0, top: 0, behavior: "instant" })
}

let navigation = 0
let cancel_navigation = (): void => {}
const delay = (ms: number): Promise<void> => new Promise(done => setTimeout(done, ms))

function transition_names(active: boolean): void {
    document.documentElement.toggleAttribute("data-spa-transition", active)
    Array.from(document.querySelectorAll<HTMLElement>("#head_tray > *"), (child, index) => {
        if (active) child.style.viewTransitionName = `spa-tray-${index}`
        else child.style.removeProperty("view-transition-name")
    })
}

export async function navigate(url: URL, push: boolean, position?: [number, number]): Promise<void> {
    const mine = ++navigation
    cancel_navigation()
    const root = document.documentElement, controller = new AbortController(), signature = page_signature()
    let outgoing: ReturnType<typeof wipe_page> | undefined
    let incoming: ReturnType<typeof wipe_page> | undefined
    let transition: ViewTransition | undefined
    let loading = false, showing_signature = false
    const show_signature = (): void => {
        if (showing_signature) return
        showing_signature = true
        void signature.show()
    }
    root.dataset.spa = ""
    // A warm response gets one continuous old/new wipe and no loader flash.
    // While a request is slow, wipe the old page and move the live SVG to center.
    const slow = setTimeout(() => {
        outgoing = wipe_page("out")
        show_signature()
    }, 140)
    cancel_navigation = () => {
        clearTimeout(slow)
        controller.abort()
        transition?.skipTransition()
        outgoing?.cancel()
        incoming?.cancel()
        signature.cancel()
        cancel_page_loading()
        transition_names(false)
        delete root.dataset.spa
    }
    const start_loading = (center = true): void => {
        loading = true
        if (center) show_signature()
        begin_loading("page")
    }
    const render = (payload: page_payload, paint = true): Promise<unknown> => {
        if (push) {
            history.replaceState({ ...history.state, jazu_scroll: [scrollX, scrollY] }, "")
            history.pushState({}, "", url)
        }
        current_path = url.pathname + url.search
        const styles = swap_page(payload)
        if (position) scrollTo({ left: position[0], top: position[1], behavior: "instant" })
        else scroll_to_hash(url.hash)
        init_reveal()
        update_tab_spy()
        // Styles can introduce fonts; wait for them after the CSS has applied.
        return styles.then(() => wait_resources(document, paint))
    }
    try {
        const payload = await fetch_payload(url, controller)
        clearTimeout(slow)
        if (mine !== navigation) return
        if (!payload) { cancel_navigation(); location.assign(url.href); return }
        let resources: Promise<unknown>, resources_ready = false
        if (!outgoing && document.startViewTransition && !motion_reduced()) {
            transition_names(true)
            transition = document.startViewTransition(async () => {
                if (mine !== navigation) return
                resources = render(payload, false).then(() => { resources_ready = true })
                transition_names(true)
                const ready = await Promise.race([resources.then(() => true), delay(140).then(() => false)])
                if (mine !== navigation) return
                if (!ready) start_loading(false)
            })
            // Skipped transitions still run their DOM update; they must not
            // trigger a second render or create a second history entry.
            await transition.updateCallbackDone
            await transition.finished.catch(() => {})
            if (mine !== navigation) return
            transition_names(false)
            if (loading && !resources_ready) show_signature()
            await resources!
        } else {
            outgoing ??= wipe_page("out")
            await outgoing.finished
            if (mine !== navigation) return
            resources = render(payload)
            // Let cached images, styles and fonts settle without painting a
            // skeleton. Slow resources get placeholders before the incoming wipe.
            const ready = await Promise.race([resources.then(() => true), delay(140).then(() => false)])
            if (mine !== navigation) return
            if (!ready) start_loading()
            outgoing.cancel()
            incoming = wipe_page("in")
            await Promise.all([incoming.finished, resources])
            if (mine !== navigation) return
            incoming.cancel()
        }
        if (mine !== navigation) return
        await Promise.all([loading ? finish_loading("page") : Promise.resolve(), showing_signature ? signature.finish() : Promise.resolve()])
        if (mine !== navigation) return
        delete root.dataset.spa
        cancel_navigation = () => {}
        announce(payload.title)
        document.getElementById("main-content")!.focus({ preventScroll: true })
    } catch {
        if (mine !== navigation) return
        cancel_navigation()
        location.assign(url.href)
    }
}

export function init_spa(): void {
    history.scrollRestoration = "manual"
    let scroll_timer = 0
    addEventListener("scroll", () => {
        if (scroll_timer || document.documentElement.hasAttribute("data-spa")) return
        scroll_timer = window.setTimeout(() => {
            scroll_timer = 0
            if (!document.documentElement.hasAttribute("data-spa"))
                history.replaceState({ ...history.state, jazu_scroll: [scrollX, scrollY] }, "")
        }, 500)
    }, { passive: true })
    document.addEventListener("click", event => {
        const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null
        if (!link || !should_intercept(event, link)) return
        event.preventDefault()
        void navigate(new URL(link.href), true)
    })
    // A same-page fragment link (#expertise, #featured/x ...) also fires popstate. The browser has already scrolled / set :target,
    // so re-rendering the page here would reload it and throw the reader back to the top. Only a different path needs a swap.
    addEventListener("popstate", event => {
        if (location.pathname + location.search === current_path) {
            ++navigation
            cancel_navigation()
            const position = event.state?.jazu_scroll
            if (position) scrollTo({ left: position[0], top: position[1], behavior: "instant" })
            else scroll_to_hash(location.hash)
            return
        }
        void navigate(new URL(location.href), false, event.state?.jazu_scroll)
    })
}
