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

export function begin_loading(owner: string): void {
    const shared = state()
    shared.revision++
    shared.owners.add(owner)
    document.documentElement.dataset.skeleton = "loading"
    document.documentElement.classList.remove("theme_ready")
    busy(true)
}

export async function finish_loading(owner: string): Promise<void> {
    const shared = state()
    shared.owners.delete(owner)
    if (shared.owners.size) return
    const revision = ++shared.revision
    const root = document.documentElement
    root.dataset.skeleton = "revealing"
    root.classList.add("theme_ready")
    await delay(motion_reduced() ? 0 : 340)
    if (revision !== shared.revision) return
    delete root.dataset.skeleton
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
