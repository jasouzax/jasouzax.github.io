import { init_reveal, update_tab_spy } from "./scroll.ts"
import { sync_theme_radios } from "./menus.ts"
import { deserialize, to_dom, type serialized_node } from "../vnode.tsx"
import { begin_loading, finish_loading, wait_resources, wipe_page } from "./loading.ts"

type page_payload = {
    path: string
    lang?: string
    loading?: string
    title: string
    header: serialized_node
    main: serialized_node
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
    if (link.origin !== location.origin) return false
    // Isolation is a document response policy; an SPA swap cannot enable it.
    const is_desk = (path: string) => /^\/(?:ja\/)?desk(?:\/|$)/.test(path)
    if (is_desk(link.pathname) !== is_desk(location.pathname)) return false
    // files (pdf, images, the .json payloads themselves) are real downloads, not pages
    if (/\.[a-z0-9]{2,5}$/i.test(link.pathname) && !link.pathname.endsWith(".html")) return false
    if (link.pathname.startsWith("/api/") || link.pathname.startsWith("/work")) return false
    return !(link.pathname === location.pathname && link.hash)
}

function json_url(url: URL): string {
    const path = url.pathname.replace(/\/$/, "")
    return `${path}/index.json`
}

async function fetch_payload(url: URL): Promise<page_payload | null> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 3000)
    try {
        const response = await fetch(json_url(url), { signal: controller.signal })
        return response.ok ? ((await response.json()) as page_payload) : null
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
    const next = to_dom(deserialize(tree)) as HTMLElement
    // Keep the SVG attached to the same header. Moving it into a replacement
    // header would restart the signature's SMIL timeline in some browsers.
    for (const child of Array.from(header.childNodes)) if (child !== signature) child.remove()
    let before_signature = true
    for (const child of Array.from(next.childNodes)) {
        if (child instanceof HTMLElement && child.id === "head_signature") {
            for (const attr of Array.from(child.attributes)) signature.setAttribute(attr.name, attr.value)
            before_signature = false
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
    sync_theme_radios()
    document.dispatchEvent(new Event("jazu:page"))
    return styles
}

let current_path = location.pathname

function scroll_to_hash(hash: string): void {
    const id = hash.length > 1 ? decodeURIComponent(hash.slice(1)) : ""
    const target = id ? document.getElementById(id) : null
    if (target) target.scrollIntoView()
    else scrollTo(0, 0)
}

let navigation = 0
let cancel_wipe = (): void => {}

export async function navigate(url: URL, push: boolean): Promise<void> {
    const mine = ++navigation
    cancel_wipe()
    const outgoing = wipe_page("out")
    const payload = await fetch_payload(url)
    const clear_outgoing = await outgoing
    // a newer click superseded this one
    if (mine !== navigation) { clear_outgoing(); return }
    cancel_wipe = clear_outgoing
    if (!payload) {
        location.assign(url.href)
        return
    }
    begin_loading("page")
    document.getElementById("loading_overlay")?.remove()
    const styles = swap_page(payload)
    clear_outgoing()
    current_path = url.pathname
    if (push) history.pushState({}, "", url)
    scroll_to_hash(url.hash)
    begin_loading("page")
    const incoming = wipe_page("in")
    // Resources can finish during the incoming wipe, but the skeleton must be
    // painted at least once before the content is revealed.
    await Promise.all([styles, wait_resources()])
    const clear_incoming = await incoming
    if (mine !== navigation) { clear_incoming(); return }
    cancel_wipe = clear_incoming
    clear_incoming()
    await finish_loading("page")
    if (mine !== navigation) return
    announce(payload.title)
    const main = document.getElementById("main-content")!
    main.focus({ preventScroll: true })
    init_reveal()
    update_tab_spy()
}

export function init_spa(): void {
    document.addEventListener("click", event => {
        const link = (event.target as HTMLElement).closest<HTMLAnchorElement>("a[href]")
        if (!link || !should_intercept(event, link)) return
        event.preventDefault()
        void navigate(new URL(link.href), true)
    })
    // A same-page fragment link (#expertise, #featured/x ...) also fires popstate. The browser has already scrolled / set :target,
    // so re-rendering the page here would reload it and throw the reader back to the top. Only a different path needs a swap.
    addEventListener("popstate", () => {
        if (location.pathname === current_path) return
        void navigate(new URL(location.href), false)
    })
}
