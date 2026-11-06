import { test, expect, type Page } from "@playwright/test"

const ready = (page: Page) => expect(page.locator("html")).not.toHaveAttribute("data-skeleton", /.+/, { timeout: 12000 })
const choose = (page: Page, id: string) => page.locator(`#${id}`).evaluate((input: HTMLInputElement) => {
    input.checked = true
    input.dispatchEvent(new Event("change", { bubbles: true }))
})

for (const mode of ["light", "dark"] as const) {
    test(`inline ${mode} skeleton paints while the theme request is held`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: mode })
        let release!: () => void
        const gate = new Promise<void>(done => { release = done })
        let release_fonts!: () => void
        const fonts = new Promise<void>(done => { release_fonts = done })
        await page.route("**/*.woff2", async route => { await fonts; await route.continue() })
        await page.route("**/assets/themes/default/*.css", async route => { await gate; await route.continue() })
        const errors: string[] = []
        page.on("console", message => { if (message.text().includes("Content Security Policy")) errors.push(message.text()) })
        await page.goto("/", { waitUntil: "domcontentloaded" })
        await expect(page.locator("html")).toHaveAttribute("data-skeleton", "loading")
        await expect(page.locator("#head")).toHaveCSS("position", "fixed")
        await expect(page.locator("body")).toHaveCSS("display", "flex")
        await expect(page.locator("h1")).toHaveCSS("visibility", "hidden")
        await expect(page.locator(".loading_placeholder").first()).toBeVisible()
        for (const group of ["hero-items", "hero-actions", "head-tray", "breadcrumbs", "head-tabs"]) {
            await expect(page.locator(`[data-skeleton-group="${group}"]`)).toHaveCount(1)
        }
        const contacts = await page.locator("#home .landing_contacts").boundingBox()
        expect(await page.locator('[data-skeleton-group="hero-items"]').boundingBox()).toEqual(contacts)
        const boxes = await page.locator(".loading_placeholder").evaluateAll(elements => elements.map(element => element.getBoundingClientRect().toJSON()))
        await page.waitForTimeout(350)
        expect(await page.locator(".loading_placeholder").evaluateAll(elements => elements.map(element => element.getBoundingClientRect().toJSON()))).toEqual(boxes)
        await expect(page.locator("html")).toHaveCSS("background-color", mode === "dark" ? "rgb(0, 0, 0)" : "rgb(255, 255, 255)")
        await expect(page.locator("#head_signature")).toBeVisible()
        await expect(page.locator("#head_path_logo")).toHaveCSS("filter", mode === "dark" ? /drop-shadow\(rgb\(0, 0, 0\)/ : /drop-shadow\(rgb\(255, 255, 255\)/)
        expect(errors).toEqual([])
        await page.screenshot({ path: `.cache/loading-${mode}.png` })
        release()
        await expect(page.locator("#theme_css")).toHaveAttribute("media", "all")
        expect(await page.locator(".loading_placeholder").evaluateAll(elements => elements.map(element => element.getBoundingClientRect().toJSON()))).toEqual(boxes)
        await expect(page.locator("h1")).toHaveCSS("visibility", "hidden")
        const band = page.locator(".loading_shapes")
        const before = await band.evaluate(element => getComputedStyle(element, "::after").transform)
        await page.waitForTimeout(120)
        expect(await band.evaluate(element => getComputedStyle(element, "::after").transform)).not.toBe(before)
        release_fonts()
        await ready(page)
        await expect(page.locator(".landing_lead").first()).not.toHaveCSS("color", "rgba(0, 0, 0, 0)")
        await expect(page.locator("h1")).toHaveCSS("background-clip", "text")
        await expect(page.locator("#main-content")).toHaveAttribute("aria-busy", "false")
        await expect(page.locator("#head_path_logo")).toHaveCSS("filter", "none")
    })
}

test("SPA wipes through a skeleton and keeps the exact signature node", async ({ page }) => {
    await page.goto("/")
    await ready(page)
    await page.evaluate(() => { (window as any).original_signature = document.getElementById("head_signature") })
    let release!: () => void
    const gate = new Promise<void>(done => { release = done })
    await page.route("**/privacy/index.json", async route => { await gate; await route.continue() })
    await page.locator('.site_foot a[href="/privacy"]').evaluate((link: HTMLAnchorElement) => link.click())
    await expect.poll(() => page.locator("#main-content").evaluate(element => getComputedStyle(element).maskImage)).toContain("linear-gradient")
    release()
    await expect(page.locator("html")).toHaveAttribute("data-skeleton", "loading")
    expect(await page.evaluate(() => (window as any).original_signature === document.getElementById("head_signature"))).toBe(true)
    await ready(page)
    await expect(page).toHaveURL(/\/privacy$/)
    await expect(page.locator("#main-content")).toBeFocused()
    await expect(page.locator("#spa_spinner")).toHaveCount(0)
    await page.goBack()
    await ready(page)
    await expect(page.locator("h1")).toContainText("Jason")
    expect(await page.evaluate(() => (window as any).original_signature === document.getElementById("head_signature"))).toBe(true)
})

test("Memory uses the inline intermediary and switches back without Default skin inheritance", async ({ page }) => {
    await page.goto("/")
    await ready(page)
    let release!: () => void
    const gate = new Promise<void>(done => { release = done })
    await page.route("**/assets/themes/memory/*.css", async route => { await gate; await route.continue() })
    await choose(page, "theme_name_memory")
    await expect(page.locator("html")).toHaveAttribute("data-theme", "")
    await expect(page.locator("html")).toHaveAttribute("data-skeleton", "loading")
    await expect(page.locator("#head")).toHaveCSS("position", "fixed")
    release()
    await ready(page)
    await expect(page.locator("html")).toHaveAttribute("data-theme", "memory")
    await expect(page.locator('link[data-theme-css="default"]')).toHaveCount(0)
    await expect(page.locator('link[data-theme-css="memory"]')).toHaveCount(1)
    await page.screenshot({ path: ".cache/loading-memory-ready.png" })
    await choose(page, "theme_state_dark")
    await ready(page)
    await expect(page.locator("html")).toHaveAttribute("data-mode", "dark")
    await choose(page, "theme_name_default")
    await ready(page)
    await expect(page.locator("html")).toHaveAttribute("data-theme", "default")
    await expect(page.locator('link[data-theme-css="memory"]')).toHaveCount(0)
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--bg-valley").trim())).toBe("#04060c")
})

test("failed theme downloads restore the current theme and reveal readable content", async ({ page }) => {
    await page.goto("/")
    await ready(page)
    await page.route("**/assets/themes/memory/*.css", route => route.abort())
    await choose(page, "theme_name_memory")
    await expect(page.locator("#spa_live")).toContainText("failed")
    await ready(page)
    await expect(page.locator("html")).toHaveAttribute("data-theme", "default")
    await expect(page.locator("#theme_name_default")).toBeChecked()
    await expect(page.locator(".landing_lead").first()).not.toHaveCSS("color", "rgba(0, 0, 0, 0)")
})

test("stored Memory and explicit dark mode restore without exposing Default", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" })
    await page.addInitScript(() => {
        localStorage.setItem("jazu_theme", "memory")
        localStorage.setItem("jazu_mode", "dark")
    })
    await page.goto("/privacy", { waitUntil: "domcontentloaded" })
    await expect(page.locator("html")).toHaveAttribute("data-mode", "dark")
    await ready(page)
    await expect(page.locator("html")).toHaveAttribute("data-theme", "memory")
    await expect(page.locator('link[data-theme-css="default"]')).toHaveCount(0)
    await expect(page.locator("#theme_state_dark")).toBeChecked()
})

test("an unavailable initial stylesheet leaves the inline layout readable", async ({ page }) => {
    await page.route("**/assets/themes/default/*.css", route => route.abort())
    await page.goto("/privacy")
    await ready(page)
    await expect(page.locator("h1")).not.toHaveCSS("color", "rgba(0, 0, 0, 0)")
    await expect(page.locator("#head")).toHaveCSS("position", "fixed")
    await expect(page.locator("#main-content")).toHaveAttribute("aria-busy", "false")
})

test("a newer theme selection wins when an earlier CSS request is slow", async ({ page }) => {
    await page.goto("/privacy")
    await ready(page)
    let release!: () => void
    const gate = new Promise<void>(done => { release = done })
    await page.route("**/assets/themes/memory/*.css", async route => { await gate; await route.continue() })
    await choose(page, "theme_name_memory")
    await expect(page.locator("html")).toHaveAttribute("data-theme", "")
    await choose(page, "theme_name_default")
    release()
    await expect.poll(() => page.evaluate(() => localStorage.getItem("jazu_theme"))).toBe("default")
    await ready(page)
    await expect(page.locator("html")).toHaveAttribute("data-theme", "default")
    await expect(page.locator("link[data-theme-css]")).toHaveCount(1)
})

test("reduced motion stops shimmer, and JavaScript-disabled pages remain readable", async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: "reduce", baseURL: "http://127.0.0.1:8125" })
    const page = await context.newPage()
    let release!: () => void
    const gate = new Promise<void>(done => { release = done })
    await page.route("**/assets/themes/default/*.css", async route => { await gate; await route.continue() })
    await page.goto("/", { waitUntil: "domcontentloaded" })
    expect(await page.locator(".loading_shapes").evaluate(element => getComputedStyle(element, "::after").animationName)).toBe("none")
    release()
    await context.close()
    const nojs = await browser.newContext({ javaScriptEnabled: false, baseURL: "http://127.0.0.1:8125" })
    const plain = await nojs.newPage()
    await plain.goto("/privacy")
    await expect(plain.locator("html")).not.toHaveAttribute("data-skeleton")
    await expect(plain.locator("h1")).not.toHaveCSS("-webkit-text-fill-color", "rgba(0, 0, 0, 0)")
    await expect(plain.locator("#head")).toHaveCSS("position", "fixed")
    await nojs.close()
})


test("inline boot paints placeholders before the page runtime downloads", async ({ page }) => {
    let release!: () => void
    const gate = new Promise<void>(done => { release = done })
    await page.route("**/assets/runtime/page.*.js", async route => { await gate; await route.continue() })
    await page.goto("/", { waitUntil: "commit" })
    await expect(page.locator(".loading_placeholder").first()).toBeVisible()
    await expect(page.locator("#main-content")).toHaveCSS("visibility", "hidden")
    release()
    await ready(page)
})


for (const theme of ["default", "memory"]) {
    test(`${theme} mode changes never enter skeleton loading`, async ({ page }) => {
        await page.goto("/privacy")
        await ready(page)
        if (theme === "memory") {
            await choose(page, "theme_name_memory")
            await expect(page.locator("html")).toHaveAttribute("data-theme", theme)
            await ready(page)
        }
        await page.evaluate(() => {
            const records: string[] = []
            const background = document.getElementById("theme_background")
            const observer = new MutationObserver(changes => {
                for (const change of changes) {
                    if (change.type === "attributes") records.push("skeleton-state")
                    for (const node of change.addedNodes) {
                        if (node instanceof Element && node.id === "loading_overlay") records.push("overlay")
                    }
                }
            })
            observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-skeleton"] })
            observer.observe(document.body, { childList: true })
            ;(window as any).mode_check = { records, background, observer }
        })
        for (const mode of ["light", "dark", "auto"]) {
            await choose(page, `theme_state_${mode}`)
            await expect(page.locator("html")).toHaveAttribute("data-mode", mode)
            await expect(page.locator("#main-content")).toHaveAttribute("aria-busy", "false")
        }
        const result = await page.evaluate(() => {
            const check = (window as any).mode_check
            check.observer.disconnect()
            return { records: check.records, sameBackground: check.background === document.getElementById("theme_background") }
        })
        expect(result).toEqual({ records: [], sameBackground: true })
        await expect(page.locator("#loading_overlay")).toHaveCount(0)
    })
}


for (const theme of ["default", "memory"]) {
    test(`${theme} typing and cursor start together after skeleton loading`, async ({ page }) => {
        let release!: () => void
        const gate = new Promise<void>(done => { release = done })
        await page.route("**/assets/themes/default/*.css", async route => { await gate; await route.continue() })
        await page.goto("/", { waitUntil: "domcontentloaded" })
        expect(await page.locator(".landing_role").first().evaluate(element => getComputedStyle(element, "::after").animationName)).toBe("none")
        await expect(page.locator(".landing_role_text").first()).toHaveCSS("animation-name", "none")
        release()
        await ready(page)
        if (theme === "memory") {
            await choose(page, "theme_name_memory")
            await expect(page.locator("html")).toHaveAttribute("data-theme", "memory")
            await ready(page)
        }
        const samples = await page.locator(".landing_role").first().evaluate(element => {
            const animations = element.getAnimations({ subtree: true }).filter(animation =>
                animation instanceof CSSAnimation && /^role_(type|caret)_/.test(animation.animationName))
            const starts = animations.map(animation => Number(animation.startTime))
            const errors = [1800, 2800, 4300].map(time => {
                animations.forEach(animation => { animation.pause(); animation.currentTime = time })
                const text = element.querySelector(".landing_role_text")!
                const clip = getComputedStyle(text).clipPath
                const hidden = Number(clip.match(/([\d.]+)%/)?.[1] ?? 0) / 100
                const expected = text.getBoundingClientRect().width * (1 - hidden)
                return Math.abs(parseFloat(getComputedStyle(element, "::after").left) - expected)
            })
            return { count: animations.length, startDifference: Math.max(...starts) - Math.min(...starts), errors }
        })
        expect(samples.count).toBe(2)
        expect(samples.startDifference).toBeLessThanOrEqual(1)
        for (const error of samples.errors) expect(error).toBeLessThan(1)
    })
}


test("one signature draws at the center before shrinking into the header", async ({ page }) => {
    let release!: () => void
    const gate = new Promise<void>(done => { release = done })
    await page.route("**/assets/themes/default/*.css", async route => { await gate; await route.continue() })
    await page.goto("/", { waitUntil: "commit" })
    const signature = page.locator("#head_path_logo")
    await expect(signature).toHaveCSS("position", "fixed")
    await expect(signature).toHaveCount(1)
    await expect(page.locator("#signature_intro")).toHaveCount(0)
    await expect(signature).toHaveCSS("transform", "none")
    await expect.poll(async () => {
        const rect = (await signature.boundingBox())!
        return Math.abs(rect.width - 250) + Math.abs(rect.x + rect.width / 2 - 720) + Math.abs(rect.y + rect.height / 2 - 500)
    }).toBeLessThan(1)
    await page.evaluate(() => { (window as any).intro_signature = document.getElementById("head_path_logo") })
    await expect(page.locator(".loading_placeholder").first()).toBeVisible()
    const drawing = await signature.evaluate(element => {
        const svg = element as unknown as SVGSVGElement
        const effects = svg.getAnimations({ subtree: true }).map(animation => animation.effect as KeyframeEffect)
        const paths = effects.map(effect => effect.getKeyframes()).filter(frames => frames.some(frame => "d" in frame))
        return { tags: svg.querySelectorAll("animate").length, paths: paths.length,
            morphs: paths.every(frames => frames[0].d !== frames[frames.length - 1].d) }
    })
    expect(drawing.tags).toBeGreaterThan(0)
    expect(drawing.paths).toBe(drawing.tags)
    expect(drawing.morphs).toBe(true)
    release()
    await expect.poll(() => signature.evaluate(element =>
        getComputedStyle(element).position !== "fixed" && element.getAnimations().some(animation => animation.playState === "running")), { intervals: [25] }).toBe(true)
    await ready(page)
    await expect(signature).toHaveCount(1)
    const header = (await signature.boundingBox())!
    expect(header.width).toBeLessThan(100)
    expect(header.y + header.height).toBeLessThan(40)
    expect(await page.evaluate(() => (window as any).intro_signature === document.getElementById("head_path_logo"))).toBe(true)
    await page.locator('.site_foot a[href="/privacy"]').evaluate((link: HTMLAnchorElement) => link.click())
    await expect(page).toHaveURL(/\/privacy$/)
    await ready(page)
    await expect(signature).not.toHaveCSS("position", "fixed")
    await expect(page.locator("#signature_intro")).toHaveCount(0)
})


for (const mode of ["light", "dark"] as const) {
    test(`expertise ${mode} skeleton groups sections without overlapping filters`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: mode })
        await page.goto("/")
        await ready(page)
        await page.evaluate(() => {
            document.documentElement.style.scrollSnapType = "none"
            document.documentElement.style.scrollBehavior = "auto"
            const head = document.querySelector("#expertise .expertise_head")!
            scrollTo(0, head.getBoundingClientRect().top + scrollY - 60)
        })
        await expect.poll(() => page.locator("#expertise .expertise_head").evaluate(element => Math.abs(element.getBoundingClientRect().top - 60))).toBeLessThan(2)
        let release!: () => void
        const gate = new Promise<void>(done => { release = done })
        await page.route("**/assets/themes/memory/*.css", async route => { await gate; await route.continue() })
        await choose(page, "theme_name_memory")
        await expect(page.locator("html")).toHaveAttribute("data-skeleton", "loading", { timeout: 10000 })
        for (const name of ["head", "timeline", "title", "all", "stacks", "card", "dots"]) {
            await expect(page.locator(`[data-skeleton-group="expertise-${name}"]`)).toHaveCount(1)
        }
        const overlapping = await page.locator('[data-skeleton-group="expertise-stacks"]').evaluate(element => {
            const filter = element.getBoundingClientRect()
            return Array.from(document.querySelectorAll(".loading_placeholder")).filter(other => {
                const box = other.getBoundingClientRect()
                return Math.min(box.right, filter.right) - Math.max(box.left, filter.left) > 1 &&
                    Math.min(box.bottom, filter.bottom) - Math.max(box.top, filter.top) > 1
            }).length
        })
        expect(overlapping).toBe(1)
        await expect(page.locator(".loading_placeholder:not([data-skeleton-group])")).toHaveCount(0)
        await page.screenshot({ path: `.cache/loading-expertise-${mode}.png` })
        release()
        await ready(page)
    })
}
