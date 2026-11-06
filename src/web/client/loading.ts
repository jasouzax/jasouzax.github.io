type loading_state = { owners: Set<string>; revision: number }
type loading_window = Window & { jazu_loading?: loading_state; jazu_boot_css?: Promise<void>; jazu_signature_done?: Promise<void> }
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
const page_targets = "#main-content, #head > :not(#head_signature):not(#head_tray), .site_foot"

// Navigation may finish at any point in the signature's entrance. Every effect
// belongs to this navigation so a subsequent click can cancel it synchronously.
export function page_signature(): { show(): Promise<void>; finish(): Promise<void>; cancel(): void } {
    const source = document.getElementById("head_path_logo") as SVGSVGElement | null
    const root = document.documentElement
    const effects = new Set<Animation>()
    let stopped = false, centered = false
    const animate = async (from: number, to: number, duration: number): Promise<void> => {
        if (!source || motion_reduced()) return
        const effect = source.animate([{ transform: `scale(${from})` }, { transform: `scale(${to})` }],
            { duration, easing: "ease-in-out", fill: "both" })
        effects.add(effect)
        await effect.finished.catch(() => {})
    }
    const clear = (): void => { effects.forEach(effect => effect.cancel()); effects.clear() }
    const complete_drawing = (): void => {
        if (!source) return
        const seconds = (value: string | null): number => value ? parseFloat(value) * (value.endsWith("ms") ? .001 : 1) : 0
        source.pauseAnimations()
        source.setCurrentTime(Math.max(0, ...Array.from(source.querySelectorAll("animate,set"), tag =>
            seconds(tag.getAttribute("begin")) + seconds(tag.getAttribute("dur")))) + .05)
    }
    return {
        async show() {
            await animate(1, 0, 180)
            if (stopped || !source) return
            centered = true
            root.dataset.signatureIntro = ""
            // Reuse the initial loader's drawing, on the original SVG paths.
            delete (window as loading_window).jazu_signature_done
            start_signature_intro()
            for (const effect of source.getAnimations({ subtree: true })) effects.add(effect)
            await animate(0, 1, 220)
        },
        async finish() {
            stopped = true
            clear()
            if (centered) {
                await animate(1, 0, 160)
                if (!centered) return
            }
            complete_drawing()
            delete root.dataset.signatureIntro
            centered = false
            clear()
            await animate(0, 1, 180)
            clear()
        },
        cancel() {
            stopped = true
            centered = false
            complete_drawing()
            clear()
            delete root.dataset.signatureIntro
        }
    }
}

// Keep the original SVG attached throughout: its drawing timeline and identity
// survive the switch from fixed center positioning back to the header layout.
export function start_signature_intro(): void {
    const source = document.getElementById("head_path_logo")
    const host = window as loading_window
    if (!(source instanceof SVGSVGElement) || !document.documentElement.hasAttribute("data-signature-intro") || host.jazu_signature_done) return
    const seconds = (value: string | null): number => value ? parseFloat(value) * (value.endsWith("ms") ? .001 : 1) : 0
    const end = Math.max(0, ...Array.from(source.querySelectorAll("animate,set"), animation =>
        seconds(animation.getAttribute("begin")) + seconds(animation.getAttribute("dur")))) + .05
    source.pauseAnimations()
    source.setCurrentTime(0)
    // Native SMIL clocks stay at zero until window.load in Chromium. Play the
    // existing tags' frames on their original paths while resources are pending.
    const drawing: Animation[] = []
    for (const tag of source.querySelectorAll("animate,set")) {
        const target = tag.parentElement
        if (!target) continue
        const begin = seconds(tag.getAttribute("begin")) * 1000
        const reduced = motion_reduced()
        if (tag.getAttribute("attributeName") === "d") {
            const values = tag.getAttribute("values")?.split(";") ?? []
            const offsets = tag.getAttribute("keyTimes")?.split(";").map(Number)
            const frames = values.map((value, index) => ({ d: `path(${JSON.stringify(value)})`, offset: offsets?.[index] ?? index / Math.max(1, values.length - 1) }))
            if (!frames.length) continue
            drawing.push(target.animate(reduced ? [frames[frames.length - 1]] : frames, { duration: reduced ? 0 : seconds(tag.getAttribute("dur")) * 1000, delay: reduced ? 0 : begin, fill: "forwards" }))
        } else if (tag.getAttribute("attributeName") === "visibility") {
            drawing.push(target.animate([{ visibility: tag.getAttribute("to") ?? "visible" }], { duration: 0, delay: reduced ? 0 : begin, fill: "forwards" }))
        }
    }
    host.jazu_signature_done = Promise.allSettled(drawing.map(animation => animation.finished)).then(() => {})
    // Once the native clock is available, freeze its completed drawing and drop
    // the temporary playback effects. The SVG and its animate tags stay intact.
    const settle = async (): Promise<void> => {
        await host.jazu_signature_done
        await new Promise<void>(done => requestAnimationFrame(() => done()))
        source.setCurrentTime(end)
        drawing.forEach(animation => animation.cancel())
    }
    if (document.readyState === "complete") void settle()
    else window.addEventListener("load", () => { void settle() }, { once: true })
}

async function finish_signature_intro(): Promise<void> {
    const root = document.documentElement
    if (!root.hasAttribute("data-signature-intro")) return
    await (window as loading_window).jazu_signature_done
    const source = document.getElementById("head_path_logo")
    let shrink: Animation | null = null
    if (source && !motion_reduced()) {
        shrink = source.animate([{ transform: "scale(1)" }, { transform: "scale(0)" }], { duration: 280, easing: "ease-in", fill: "forwards" })
        await shrink.finished
    }
    // The completed shrink keeps the SAME SVG at zero while fixed positioning
    // is removed. Its header entrance starts at zero in the same paint frame.
    delete root.dataset.signatureIntro
    const enter = source && !motion_reduced() ? source.animate([{ transform: "scale(0)" }, { transform: "scale(1)" }], { duration: 300, easing: "cubic-bezier(.22,.8,.2,1)", fill: "both" }) : null
    shrink?.cancel()
    if (enter) { await enter.finished; enter.cancel() }
}

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
    const covered = new Set<Element>()
    const add_box = (box: DOMRect, group?: string): void => {
        if (!box.width || !box.height || box.bottom < 0 || box.top > innerHeight || box.right < 0 || box.left > innerWidth) return
        const placeholder = document.createElement("div")
        placeholder.className = "loading_placeholder"
        if (group) placeholder.dataset.skeletonGroup = group
        Object.assign(placeholder.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px`, boxSizing: "border-box" })
        shine_bounds.push(`M${box.left},${box.top}h${box.width}v${box.height}h${-box.width}Z`)
        shapes.append(placeholder)
    }
    const visible_rects = (element: Element): DOMRect[] => {
        if (element.closest("[hidden]")) return []
        // display:contents has no box of its own (notably the head tray).
        if (getComputedStyle(element).display === "contents") return Array.from(element.children).flatMap(visible_rects)
        return Array.from(element.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0)
    }
    const groups: [string, string, boolean][] = [
        ["hero-items", ".landing_contacts", false],
        ["hero-actions", ".landing_actions", false],
        ["head-tray", "#head_tray", false],
        ["breadcrumbs", "#head_div, #head_path", true],
        ["head-tabs", "#head_tabs", false],
        ["expertise-head", "#expertise .expertise_head", false],
        ["expertise-timeline", "#expertise .expertise_tlhead, #expertise .expertise_tl", true],
        ["expertise-title", "#expertise .expertise_prjhead > .panel_title", false],
        ["expertise-all", "#expertise .expertise_all", false],
        ["expertise-stacks", "#expertise .expertise_stacks", false],
        ["expertise-card", "#expertise .slide_card", false],
        ["expertise-dots", "#expertise .expertise_dots", false]
    ]
    for (const [name, selector, combine] of groups) {
        if (name === "head-tray" && document.documentElement.hasAttribute("data-spa")) continue
        const elements = Array.from(document.querySelectorAll(selector))
        const sets = combine ? [elements] : elements.map(element => [element])
        for (const members of sets) {
            members.forEach(member => covered.add(member))
            const rects = members.flatMap(member => {
                const boxes = visible_rects(member)
                if (name !== "expertise-card") return boxes
                // Cards outside the horizontal scrollport must not create
                // extra placeholders over neighbouring expertise controls.
                const track = member.closest(".expertise_track")?.getBoundingClientRect()
                if (!track) return boxes
                return boxes.map(box => {
                    const left = Math.max(box.left, track.left), top = Math.max(box.top, track.top)
                    const right = Math.min(box.right, track.right), bottom = Math.min(box.bottom, track.bottom)
                    return new DOMRect(left, top, Math.max(0, right - left), Math.max(0, bottom - top))
                }).filter(box => box.width > 0 && box.height > 0)
            })
            if (!rects.length) continue
            const left = Math.min(...rects.map(rect => rect.left)), top = Math.min(...rects.map(rect => rect.top))
            const right = Math.max(...rects.map(rect => rect.right)), bottom = Math.max(...rects.map(rect => rect.bottom))
            add_box(new DOMRect(left, top, right - left, bottom - top), name)
        }
    }
    // Expertise has explicit section placeholders. Its state/empty messages and
    // scroll controls must not add smaller boxes on top of those sections.
    const expertise = document.getElementById("expertise")
    if (expertise) covered.add(expertise)
    const selector = "h1,h2,h3,p,button,input,textarea,summary,.landing_contact,.landing_btn,#head_path > a,#head_tabs > a,.site_foot > a"
    for (const element of document.querySelectorAll<HTMLElement>(selector)) {
        if (element.closest("#head_signature, [hidden]")) continue
        if (document.documentElement.hasAttribute("data-spa") && element.closest("#head_tray")) continue
        let parent: Element | null = element
        while (parent && !covered.has(parent)) parent = parent.parentElement
        if (parent) continue
        // Nested labels are covered by their enclosing control.
        if (element.parentElement?.closest("button,.landing_contact,.landing_btn")) continue
        add_box(element.getBoundingClientRect())
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
    if (owner !== "page") {
        document.documentElement.dataset.backgroundWait = ""
        document.documentElement.classList.remove("theme_ready")
    }
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
    if (owner === "page") {
        root.dataset.skeleton = "revealing"
        const effects = motion_reduced() ? [] : [
            ...Array.from(document.querySelectorAll<HTMLElement>(page_targets), target =>
                target.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, fill: "both" })),
            ...(overlay ? [overlay.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, fill: "both" })] : [])
        ]
        await Promise.allSettled(effects.map(effect => effect.finished))
        effects.forEach(effect => effect.cancel())
        if (revision !== shared.revision) return
        overlay?.remove()
        delete root.dataset.skeleton
        busy(false)
        return
    }
    await delay(motion_reduced() ? 0 : Math.max(0, 350 - (performance.now() - Number(overlay?.dataset.started ?? 0))))
    if (revision !== shared.revision) return
    // Fade the neutral canvas into the skin's base color before starting WebGL.
    root.dataset.skeleton = "revealing"
    overlay?.classList.add("background_fade")
    const signature_intro = finish_signature_intro()
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
    await Promise.all([delay(motion_reduced() ? 0 : 700), signature_intro])
    if (revision !== shared.revision) { animations.forEach(animation => animation.cancel()); return }
    animations.forEach(animation => animation.cancel())
    overlay?.remove()
    delete root.dataset.skeleton
    delete root.dataset.backgroundWait
    root.classList.add("theme_ready")
    document.dispatchEvent(new Event("jazu:background-ready"))
    busy(false)
}

export function cancel_page_loading(): void {
    const shared = state()
    shared.owners.delete("page")
    shared.revision++
    if (shared.owners.size) return
    document.getElementById("loading_overlay")?.remove()
    delete document.documentElement.dataset.skeleton
    busy(false)
}

// Bound every optional resource: broken fonts/media must not trap a visitor in a
// skeleton. Lazy images, videos and below-the-fold media remain lazy.
export async function wait_resources(scope: ParentNode = document, paint = true): Promise<void> {
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
    // View-transition updates suspend painting until their callback returns.
    // Waiting for animation frames inside that callback would force even a
    // fully cached destination through the slow-loading path.
    if (paint) await new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done())))
}

export function boot_css_ready(): Promise<void> {
    return (window as loading_window).jazu_boot_css ?? Promise.resolve()
}

export function wipe_page(direction: "out" | "in"): { finished: Promise<unknown>; cancel(): void } {
    if (motion_reduced()) return { finished: Promise.resolve(), cancel() {} }
    const targets = document.querySelectorAll<HTMLElement>(page_targets + (direction === "in" ? ", #loading_overlay" : ""))
    const gradient = direction === "out"
        ? "linear-gradient(135deg, transparent 40%, #000 60%)"
        : "linear-gradient(135deg, #000 40%, transparent 60%)"
    const animations = Array.from(targets, target => {
        const rect = target.getBoundingClientRect()
        return target.animate([
            { maskImage: gradient, maskSize: "300vw 300vh", maskPosition: `${-2 * innerWidth - rect.left}px ${-2 * innerHeight - rect.top}px`, maskRepeat: "no-repeat" },
            { maskImage: gradient, maskSize: "300vw 300vh", maskPosition: `${-rect.left}px ${-rect.top}px`, maskRepeat: "no-repeat" }
        ], { duration: 360, easing: "ease-in-out", fill: "both" })
    })
    return { finished: Promise.allSettled(animations.map(animation => animation.finished)), cancel: () => animations.forEach(animation => animation.cancel()) }
}
