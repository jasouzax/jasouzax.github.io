function area_in_view(element: Element): number {
    const box = element.getBoundingClientRect()
    const height = Math.max(0, Math.min(box.bottom, innerHeight) - Math.max(box.top, 0))
    const width = Math.max(0, Math.min(box.right, innerWidth) - Math.max(box.left, 0))
    return height * width
}

export function update_tab_spy(): void {
    const links = [...document.querySelectorAll<HTMLAnchorElement>('#head_tabs a[href^="#"]')]
    const targets = links.map(link => ({ link, element: document.getElementById(decodeURIComponent(link.hash.slice(1))) })).filter(item => item.element)
    let best: (typeof targets)[number] | null = null
    let most = 0
    for (const item of targets) {
        const area = area_in_view(item.element!)
        if (area > most) {
            most = area
            best = item
        }
    }
    for (const item of targets) {
        if (item === best) item.link.setAttribute("aria-current", "location")
        else item.link.removeAttribute("aria-current")
    }
}

export function init_scroll(): void {
    const root = document.documentElement
    const mark = (): void => {
        root.toggleAttribute("data-scrolled", scrollY > 8)
    }
    let frame = 0
    const queue = (): void => {
        if (frame) return
        frame = requestAnimationFrame(() => {
            frame = 0
            update_tab_spy()
        })
    }
    mark()
    addEventListener("scroll", mark, { passive: true })
    addEventListener("scroll", queue, { passive: true })
    addEventListener("resize", queue)
    addEventListener("hashchange", queue)
    setTimeout(() => {
        const background = document.querySelector(".background")
        if (background && !background.classList.contains("ready")) background.classList.add("fallback")
    }, 3000)
    update_tab_spy()
}

export function init_reveal(): void {
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches
    if (!("IntersectionObserver" in window) || reduced) return
    const root = document.documentElement
    root.classList.add("reveal")
    const show = (element: Element): void => element.classList.add("in")
    const observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
            const seen = entry.isIntersecting && (entry.intersectionRatio >= 0.25 || entry.intersectionRect.height >= innerHeight * 0.4)
            if (!seen) continue
            show(entry.target)
            observer.unobserve(entry.target)
        }
    }, { threshold: [0, 0.25, 0.5] })
    for (const article of document.querySelectorAll(".article:not(.landing)")) observer.observe(article)
    setTimeout(() => {
        for (const article of document.querySelectorAll(".article:not(.in)")) {
            if (article.getBoundingClientRect().top < innerHeight * 0.75) show(article)
        }
    }, 2500)
}
