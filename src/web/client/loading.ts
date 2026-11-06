type loading_state = { owners: Set<string>; revision: number }
type loading_window = Window & { jazu_loading?: loading_state; jazu_boot_css?: Promise<void> }
const state = (): loading_state => (window as loading_window).jazu_loading ??= { owners: new Set(), revision: 0 }
export const motion_reduced = (): boolean => matchMedia("(prefers-reduced-motion: reduce)").matches || !!document.querySelector("#motion_pause:checked")
const delay = (ms: number): Promise<void> => new Promise(done => setTimeout(done, ms))

function busy(value: boolean): void {
    const main = document.getElementById("main-content")
    if (main) {
        main.setAttribute("aria-busy", String(value))
        main.inert = value
    }
}

const content_targets = "#main-content, #head > :not(#head_signature):not(#head_tray), #head_tray > *, .site_foot"

export function capture_skeleton(): void {
    if (document.getElementById("loading_overlay")) return
    const overlay = document.createElement("div")
    overlay.id = "loading_overlay"
    overlay.dataset.started = String(performance.now())
    overlay.setAttribute("aria-hidden", "true")
    const shapes = document.createElement("div")
    shapes.className = "loading_shapes"
    overlay.append(shapes)
    const shine_bounds: string[] = []
    const selector = "h1,h2,h3,p,button,input,textarea,summary,.landing_contact,.landing_btn,#head_path > a,#head_tabs > a,.site_foot > a"
    for (const element of document.querySelectorAll<HTMLElement>(selector)) {
        if (element.closest("#head_signature, [hidden]")) continue
        const box = element.getBoundingClientRect()
        if (!box.width || !box.height || box.bottom < 0 || box.top > innerHeight || box.right < 0) continue
        // Nested labels are covered by their enclosing control.
        if (element.parentElement?.closest("button,.landing_contact,.landing_btn")) continue
        const placeholder = document.createElement("div")
        placeholder.className = "loading_placeholder"
        Object.assign(placeholder.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px`, boxSizing: "border-box" })
        shine_bounds.push(`M${box.left},${box.top}h${box.width}v${box.height}h${-box.width}Z`)
        shapes.append(placeholder)
    }
    // One viewport-sized light layer, clipped to the union of all boxes.
    shapes.style.clipPath = `path("${shine_bounds.join(" ")}")`
    document.body.append(overlay)
}

export function begin_loading(owner: string): void {
    const shared = state()
    shared.revision++
    shared.owners.add(owner)
    document.documentElement.dataset.skeleton = "loading"
    document.documentElement.dataset.backgroundWait = ""
    document.documentElement.classList.remove("theme_ready")
    capture_skeleton()
    busy(true)
}

export async function finish_loading(owner: string): Promise<void> {
    const shared = state()
    shared.owners.delete(owner)
    if (shared.owners.size) return
    const revision = ++shared.revision, root = document.documentElement
    // Suppress entrances for the content the visitor is already looking at.
    for (const article of document.querySelectorAll<HTMLElement>(".article")) {
        const box = article.getBoundingClientRect()
        if (box.bottom > 0 && box.top < innerHeight) article.classList.add("loading_settled", "in", "no_reveal")
    }
    const overlay = document.getElementById("loading_overlay")
    await delay(motion_reduced() ? 0 : Math.max(0, 350 - (performance.now() - Number(overlay?.dataset.started ?? 0))))
    if (revision !== shared.revision) return
    // Fade the neutral canvas into the skin's base color before starting WebGL.
    root.dataset.skeleton = "revealing"
    overlay?.classList.add("background_fade")
    const animations: Animation[] = []
    if (!motion_reduced()) {
        for (const target of document.querySelectorAll<HTMLElement>(content_targets)) {
            const rect = target.getBoundingClientRect()
            animations.push(target.animate([
                { maskImage: "linear-gradient(135deg,#000 40%,transparent 60%)", maskSize: "300vw 300vh", maskPosition: `${-2 * innerWidth - rect.left}px ${-2 * innerHeight - rect.top}px` },
                { maskImage: "linear-gradient(135deg,#000 40%,transparent 60%)", maskSize: "300vw 300vh", maskPosition: `${-rect.left}px ${-rect.top}px` }
            ], { duration: 500, fill: "both", easing: "ease-in-out" }))
        }
        const shapes = overlay?.querySelector<HTMLElement>(".loading_shapes")
        if (shapes) animations.push(shapes.animate([
            { maskImage: "linear-gradient(135deg,transparent 40%,#000 60%)", maskSize: "300% 300%", maskPosition: "100% 100%" },
            { maskImage: "linear-gradient(135deg,transparent 40%,#000 60%)", maskSize: "300% 300%", maskPosition: "0% 0%" }
        ], { duration: 500, fill: "both", easing: "ease-in-out" }))
    }
    await delay(motion_reduced() ? 0 : 700)
    if (revision !== shared.revision) { animations.forEach(animation => animation.cancel()); return }
    animations.forEach(animation => animation.cancel())
    overlay?.remove()
    delete root.dataset.skeleton
    delete root.dataset.backgroundWait
    root.classList.add("theme_ready")
    document.dispatchEvent(new Event("jazu:background-ready"))
    busy(false)
}

// Bound every optional resource: broken fonts/media must not trap a visitor in a
// skeleton. Lazy images, videos and below-the-fold media remain lazy.
export async function wait_resources(scope: ParentNode = document): Promise<void> {
    const pending: Promise<unknown>[] = []
    // Applying a new skin may request a different font only during layout.
    document.documentElement.getBoundingClientRect()
    if (document.fonts) pending.push(document.fonts.ready)
    for (const link of document.querySelectorAll<HTMLLinkElement>('link[data-page-css]')) {
        if (link.sheet || link.media === "print") continue
        pending.push(new Promise<void>(done => {
            link.addEventListener("load", () => done(), { once: true })
            link.addEventListener("error", () => done(), { once: true })
        }))
    }
    for (const image of scope.querySelectorAll<HTMLImageElement>('img:not([loading="lazy"])')) {
        if (image.complete) continue
        const box = image.getBoundingClientRect()
        if (box.bottom < 0 || box.top > innerHeight) continue
        pending.push(new Promise<void>(done => {
            image.addEventListener("load", () => done(), { once: true })
            image.addEventListener("error", () => done(), { once: true })
        }))
    }
    await Promise.race([Promise.allSettled(pending), delay(4000)])
    // Give styles and fonts a layout/paint opportunity before removing the cover.
    await new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done())))
}

export function boot_css_ready(): Promise<void> {
    return (window as loading_window).jazu_boot_css ?? Promise.resolve()
}

export async function wipe_page(direction: "out" | "in"): Promise<() => void> {
    if (motion_reduced()) return () => {}
    const targets = document.querySelectorAll<HTMLElement>("#main-content, #head > :not(#head_signature):not(#head_tray), #head_tray > *, .site_foot")
    const gradient = direction === "out"
        ? "linear-gradient(135deg, transparent 40%, #000 60%)"
        : "linear-gradient(135deg, #000 40%, transparent 60%)"
    const animations = Array.from(targets, target => target.animate([
        { maskImage: gradient, maskSize: "300% 300%", maskPosition: "100% 100%", maskRepeat: "no-repeat" },
        { maskImage: gradient, maskSize: "300% 300%", maskPosition: "0% 0%", maskRepeat: "no-repeat" }
    ], { duration: 360, easing: "ease-in-out", fill: "forwards" }))
    await Promise.allSettled(animations.map(animation => animation.finished))
    return () => animations.forEach(animation => animation.cancel())
}
