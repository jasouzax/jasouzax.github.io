import { test, expect } from "./desk_fixture.ts"

for (const theme of ["default", "memory"]) {
    test(`${theme} responds to live contrast, transparency, motion and forced-color preferences`, async ({ page, context }) => {
        const errors: string[] = []; page.on("pageerror", error => errors.push(error.message))
        await page.addInitScript(theme => { localStorage.setItem("jazu_theme", theme); localStorage.setItem("jazu_mode", "auto") }, theme)
        const cdp = await context.newCDPSession(page)
        const media = async (features: Record<string, string>) => {
            await cdp.send("Emulation.setEmulatedMedia", { features: Object.entries({ "prefers-color-scheme": "light", ...features }).map(([name, value]) => ({ name, value })) })
        }
        await media({ "prefers-reduced-motion": "reduce", "prefers-color-scheme": "light" })
        await page.goto("/desk")
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme)
        const light = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--text"))
        await media({ "prefers-reduced-motion": "reduce", "prefers-color-scheme": "dark" })
        await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--text"))).not.toBe(light)
        const no_motion = () => page.locator(".desk_wbox").first().evaluate(element => {
            element.style.animation = "preference-probe 3s infinite"; element.style.transition = "opacity 2s"
            const css = getComputedStyle(element)
            return { duration: parseFloat(css.animationDuration), iterations: css.animationIterationCount, transition: css.transitionDuration }
        })
        const reduced = await no_motion()
        expect(reduced.duration).toBeLessThanOrEqual(.000001)
        expect(reduced).toMatchObject({ iterations: "1", transition: "0s" })
        await media({ "prefers-contrast": "more", "prefers-reduced-motion": "reduce" })
        expect(await page.evaluate(() => {
            const css = getComputedStyle(document.documentElement)
            return [css.getPropertyValue("--text").trim(), css.getPropertyValue("--text-dim").trim(), css.getPropertyValue("--edge").trim()]
        })).toEqual([light.trim(), light.trim(), light.trim()])
        await media({ "prefers-contrast": "less", "prefers-reduced-motion": "reduce" })
        expect(await page.locator(".desk_wbox").first().evaluate(element => getComputedStyle(element).boxShadow)).toBe("none")
        await media({ "prefers-reduced-transparency": "reduce", "prefers-reduced-motion": "reduce" })
        expect(await page.evaluate(() => {
            const css = getComputedStyle(document.documentElement)
            return css.getPropertyValue("--surface").trim() === css.getPropertyValue("--panel").trim()
        })).toBe(true)
        expect(await page.locator(".desk_wbox").first().evaluate(element => getComputedStyle(element).backdropFilter)).toBe("none")
        await media({ "forced-colors": "active" })
        await expect(page.locator("#theme_background")).toBeHidden()
        if (theme === "memory") {
            await expect(page.locator(".memory_bg").first()).toBeHidden()
            await expect(page.locator("#head_window .list_drop_icon").first()).toHaveCSS("opacity", "1")
        }
        expect(await page.locator(".desk_wbox_body_empty_folder").first().evaluate(element => {
            const css = getComputedStyle(element)
            return css.color !== css.backgroundColor && css.backgroundImage === "none"
        })).toBe(true)
        await expect(page.locator(".desk_wbox_head_save").first()).toHaveCSS("font-family", /Jasouza/)
        expect((await no_motion()).duration).toBeLessThanOrEqual(.000001)
        const path = page.locator(".desk_wbox_head_path").first()
        await path.focus()
        await expect(path).toBeFocused()
        expect(await path.evaluate(element => {
            const css = getComputedStyle(element), probe = document.createElement("span")
            probe.style.color = "Highlight"; document.body.append(probe)
            const color = getComputedStyle(probe).color; probe.remove()
            return { color: css.outlineColor === color, width: css.outlineWidth, style: css.outlineStyle }
        })).toEqual({ color: true, width: "3px", style: "solid" })
        await page.screenshot({ path: `.cache/preferences-${theme}-forced.png` })
        await media({ "forced-colors": "none", "prefers-reduced-motion": "reduce" })
        await expect(page.locator("#theme_background")).not.toHaveCSS("display", "none")
        expect(errors).toEqual([])
    })
}
