import { test, expect, type Page } from "@playwright/test"

const ready = (page: Page) => expect(page.locator("html")).not.toHaveAttribute("data-skeleton", /.+/, { timeout: 12000 })
const navigated = async (page: Page) => {
    await expect(page.locator("html")).not.toHaveAttribute("data-spa", "", { timeout: 12000 })
    await ready(page)
}
const spa_ready = async (page: Page) => {
    await ready(page)
    // Keep shader rendering from consuming the transition's timing budget in
    // headless software WebGL. The actual background DOM stays in place.
    await page.evaluate(() => {
        const layer = document.querySelector<HTMLElement>("#theme_background .background")
        const theme = (window as any).jazu_theme_modules?.default
        if (layer && theme) theme.mount(layer, { name: "default", mode: "auto" }).pause()
    })
}
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
    await spa_ready(page)
    await page.evaluate(() => {
        (window as any).original_signature = document.getElementById("head_signature")
        ;(window as any).original_logo = document.getElementById("head_path_logo")
        ;(window as any).original_background = document.getElementById("theme_background")
        ;(window as any).original_tray = document.getElementById("head_tray")
    })
    let release!: () => void
    const gate = new Promise<void>(done => { release = done })
    let release_image!: () => void
    const image = new Promise<void>(done => { release_image = done })
    await page.route("**/spa-resource.svg", async route => {
        await image
        await route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/>' })
    })
    await page.route("**/privacy/index.json", async route => {
        const response = await route.fetch(), json = await response.json()
        json.main.push(["img", { src: "/spa-resource.svg", width: 100, height: 100, style: "position:fixed;top:100px;left:200px" }])
        await gate
        await route.fulfill({ json })
    })
    await page.locator('.site_foot a[href="/privacy"]').evaluate((link: HTMLAnchorElement) => link.click())
    await expect.poll(() => page.locator("#main-content").evaluate(element => getComputedStyle(element).maskImage)).toContain("linear-gradient")
    await expect(page.locator("#head_path_logo")).toHaveCSS("position", "fixed")
    await expect(page.locator("#head_tray")).toBeVisible()
    await expect(page.locator("#theme_background")).toBeVisible()
    release()
    await expect(page.locator("html")).toHaveAttribute("data-skeleton", "loading")
    await expect(page.locator('[data-skeleton-group="head-tray"]')).toHaveCount(0)
    await expect(page.locator("#head_theme")).toBeVisible()
    await expect(page.locator("#head_theme > summary")).toHaveCSS("visibility", "visible")
    expect(await page.evaluate(() => (window as any).original_signature === document.getElementById("head_signature"))).toBe(true)
    release_image()
    await navigated(page)
    await expect(page).toHaveURL(/\/privacy$/)
    await expect(page.locator("#main-content")).toBeFocused()
    await expect(page.locator("#spa_spinner")).toHaveCount(0)
    await page.goBack()
    await navigated(page)
    await expect(page.locator("h1")).toContainText("Jason")
    expect(await page.evaluate(() => (window as any).original_signature === document.getElementById("head_signature"))).toBe(true)
    expect(await page.evaluate(() => ["logo", "background", "tray"].every(name =>
        (window as any)[`original_${name}`] === document.getElementById({ logo: "head_path_logo", background: "theme_background", tray: "head_tray" }[name]!)))).toBe(true)
})

test("warm SPA navigation pairs diagonal masks without a skeleton or centered signature", async ({ page }) => {
    await page.goto("/")
    await spa_ready(page)
    const payload = await (await page.request.get("/privacy/index.json")).json()
    payload.styles = []
    // Keep this path deterministic: this case has no destination resources.
    payload.main = [null, {}, ["h1", {}, "Warm destination"]]
    await page.evaluate(payload => {
        // Model an already cached JSON response without automation transport
        // latency accidentally selecting the slow-request branch.
        const original_fetch = window.fetch
        window.fetch = (input, init) => {
            if (input === "/privacy/index.json?fast=1") {
                window.fetch = original_fetch
                return Promise.resolve(new Response(JSON.stringify(payload), { headers: { "Content-Type": "application/json" } }))
            }
            return original_fetch(input, init)
        }
        const records: string[] = []
        const observer = new MutationObserver(changes => {
            for (const change of changes) if (change.attributeName) records.push(change.attributeName)
        })
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-skeleton", "data-signature-intro"] })
        ;(window as any).spa_check = { records, observer, document }
        const link = document.createElement("a")
        link.href = "/privacy/index.html?fast=1"
        document.body.append(link)
        link.click()
    }, payload)
    await expect(page).toHaveURL(/privacy\/index.html\?fast=1$/)
    await expect.poll(() => page.evaluate(() => document.getAnimations().filter(animation =>
        animation instanceof CSSAnimation && animation.animationName === "spa_wipe").length), { intervals: [10] }).toBe(2)
    await navigated(page)
    await expect(page.locator("h1")).toHaveText("Warm destination")
    expect(await page.evaluate(() => {
        const check = (window as any).spa_check
        check.observer.disconnect()
        return { sameDocument: document === check.document, records: check.records }
    })).toEqual({ sameDocument: true, records: [] })
})

test("a superseded JSON request cannot replace the newer page", async ({ page }) => {
    await page.goto("/")
    await spa_ready(page)
    let release!: () => void
    const gate = new Promise<void>(done => { release = done })
    await page.route(url => url.pathname === "/privacy/index.json", async route => {
        const response = await route.fetch()
        await gate
        await route.fulfill({ response }).catch(() => {})
    })
    await page.locator('.site_foot a[href="/privacy"]').evaluate((link: HTMLAnchorElement) => link.click())
    await expect(page.locator("#head_path_logo")).toHaveCSS("position", "fixed")
    await page.evaluate(() => {
        const link = document.createElement("a")
        link.href = "/ja/privacy"
        document.body.append(link)
        link.click()
    })
    await expect(page).toHaveURL(/\/ja\/privacy$/)
    await navigated(page)
    release()
    await page.waitForTimeout(200)
    await expect(page.locator("html")).toHaveAttribute("lang", "ja")
    await expect(page.locator(".site_foot a").first()).toHaveAttribute("href", "/ja/privacy")
    await expect(page.locator("#head_path_logo")).not.toHaveCSS("position", "fixed")
    await expect(page.locator("#main-content")).toHaveAttribute("aria-busy", "false")
})

test("SPA fallback and reduced motion reveal failed resources without trapping the loader", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" })
    await page.addInitScript(() => { document.startViewTransition = undefined as any })
    await page.goto("/")
    await spa_ready(page)
    await page.route("**/privacy/index.json", async route => {
        const response = await route.fetch(), json = await response.json()
        json.main.push(["img", { src: "/missing-spa.svg", style: "position:fixed;top:100px;left:200px" }])
        await route.fulfill({ json })
    })
    await page.route("**/missing-spa.svg", route => route.abort())
    await page.locator('.site_foot a[href="/privacy"]').evaluate((link: HTMLAnchorElement) => link.click())
    await expect(page).toHaveURL(/\/privacy$/)
    await navigated(page)
    await expect(page.locator("#head_path_logo")).not.toHaveCSS("position", "fixed")
    await expect(page.locator("#loading_overlay")).toHaveCount(0)
    await expect(page.locator("#main-content")).toBeFocused()
})

test("SPA leaves modified clicks, new tabs, downloads and local fragments to the browser", async ({ page }) => {
    await page.goto("/")
    await spa_ready(page)
    const intercepted = await page.evaluate(() => {
        const results: boolean[] = []
        // This listener runs after the router; suppress native actions after
        // recording whether the router claimed each click.
        const observe = (event: MouseEvent): void => { results.push(event.defaultPrevented); event.preventDefault() }
        document.addEventListener("click", observe)
        const cases = [
            { href: "/privacy", ctrlKey: true }, { href: "/privacy", metaKey: true },
            { href: "/privacy", shiftKey: true }, { href: "/privacy", altKey: true },
            { href: "/privacy", button: 1 }, { href: "/privacy", button: 2 },
            { href: "/privacy", target: "_blank" }, { href: "/privacy", download: "privacy.html" },
            { href: "https://example.com/privacy" }, { href: "mailto:test@example.com" },
            { href: "/assets/example.pdf" }, { href: "/work" }, { href: "/api/status" },
            { href: "#expertise" }, { href: "#" }
        ]
        for (const item of cases) {
            const link = document.createElement("a")
            link.href = item.href
            if ("target" in item) link.target = item.target!
            if ("download" in item) link.download = item.download!
            document.body.append(link)
            link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...item }))
            link.remove()
        }
        document.removeEventListener("click", observe)
        return results
    })
    expect(intercepted).toEqual(Array(15).fill(false))
    await expect(page).toHaveURL(/\/$/)
    await expect(page.locator("html")).not.toHaveAttribute("data-spa", "")
})

for (const prefix of ["", "/ja"]) {
    test(`desktop ${prefix || "English"} uses JSON navigation and runs its terminal without reloading`, async ({ page }) => {
        test.setTimeout(60000)
        const documents: string[] = [], errors: string[] = []
        page.on("request", request => {
            if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents.push(request.url())
        })
        page.on("pageerror", error => errors.push(error.message))
        page.on("console", message => {
            if (/Content Security Policy|requires cross-origin isolation/i.test(message.text())) errors.push(message.text())
        })
        await page.goto(`${prefix}/`)
        await spa_ready(page)
        expect(await page.evaluate(() => crossOriginIsolated && typeof SharedArrayBuffer !== "undefined")).toBe(true)
        await page.evaluate(() => {
            ;(window as any).desktop_navigation = {
                document, signature: document.getElementById("head_path_logo"), background: document.getElementById("theme_background")
            }
        })
        const desktop = `${prefix}/desk`
        await page.locator("#head_div > summary").click()
        await Promise.all([
            page.waitForRequest(request => new URL(request.url()).pathname === `${desktop}/index.json`),
            page.locator(`#head_div a[href="${desktop}"]`).click()
        ])
        await expect(page).toHaveURL(new RegExp(`${desktop}$`))
        await navigated(page)
        await expect(page.locator(".desk[data-runtime]")).toBeVisible()
        const address = page.locator(".desk_wbox_head_path").first()
        await address.fill("pid:")
        await address.press("Enter")
        const screen = page.locator(".xterm-rows")
        await expect(screen).toContainText("user@jasouza:/home/user$", { timeout: 15000 })
        await page.locator(".xterm-helper-textarea").pressSequentially("echo SPA_DESK_OK")
        await page.keyboard.press("Enter")
        await expect(screen.locator(":scope > div").filter({ hasText: /^SPA_DESK_OK\s*$/ })).toBeVisible({ timeout: 10000 })
        await page.locator("#head_signature").click()
        await expect(page).toHaveURL(new RegExp(`${prefix || "/"}$`))
        await navigated(page)
        await expect(page.locator("#home h1")).toBeVisible()
        await page.goBack()
        await expect(page).toHaveURL(new RegExp(`${desktop}$`))
        await navigated(page)
        await expect(page.locator(".desk[data-runtime]")).toBeVisible()
        expect(documents).toHaveLength(1)
        expect(await page.evaluate(() => {
            const original = (window as any).desktop_navigation
            return original?.document === document && original.signature === document.getElementById("head_path_logo") &&
                original.background === document.getElementById("theme_background") && crossOriginIsolated
        })).toBe(true)
        expect(errors).toEqual([])
    })
}

test("isolated homepage still accepts a sign-in popup callback", async ({ page, context }) => {
    test.setTimeout(45000)
    await context.route("https://accounts.google.com/o/oauth2/v2/auth?**", route =>
        route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Mock sign-in</title>" }))
    await page.goto("/")
    await spa_ready(page)
    const button = page.locator('button[data-sign="google"]')
    await button.evaluate((button: HTMLButtonElement) => { button.dataset.client = "test-client" })
    await page.locator("#head_account > summary").click()
    const opened = context.waitForEvent("page")
    await button.click()
    const popup = await opened
    await popup.waitForURL("https://accounts.google.com/**")
    expect(await popup.evaluate(() => window.opener === null)).toBe(true)
    const nonce = new URL(popup.url()).searchParams.get("nonce")
    const payload = Buffer.from(JSON.stringify({ nonce, name: "SPA User", email: "spa@example.com", exp: Math.floor(Date.now() / 1000) + 300 })).toString("base64url")
    const origin = new URL(page.url()).origin
    await popup.goto(`${origin}/#id_token=e30.${payload}.test`)
    await expect(button).toHaveAttribute("data-signed", "out", { timeout: 15000 })
    await expect(button).toContainText("SPA User")
    await popup.close()
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
