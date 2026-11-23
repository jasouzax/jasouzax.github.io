/* Actual reader, Canvas/WebCodecs, audio muxing and cancellation checks. */
import { readFile } from "node:fs/promises"
import { test, expect } from "./desk_fixture.ts"
import { Input, BufferSource, ALL_FORMATS } from "mediabunny"

test("nested scenes remain readable in both orientations and deterministic on seek", async ({ page }) => {
    await page.goto("/blogs/chaos-theory")
    await expect(page.locator(".desk .blog_scene_heading h2")).toHaveText("The logistic map")
    await expect(page.locator(".desk .blog_scene_heading h3")).toHaveText("Try it yourself")
    await expect(page.locator(".desk > .desk_wbox")).toHaveCount(2)
    const pixels = async () => page.locator(".blog_media canvas").evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())
    const first = await pixels()
    await page.locator("[data-blog-seek]").fill("4")
    expect(await pixels()).not.toBe(first)
    await page.locator("[data-blog-seek]").fill("0")
    expect(await pixels()).toBe(first)
    await page.getByRole("button", { name: "Play", exact: true }).click()
    await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible()
    await expect.poll(() => page.locator("[data-blog-seek]").inputValue()).not.toBe("0")
    await page.getByRole("button", { name: "Pause", exact: true }).click()
    await page.setViewportSize({ width: 390, height: 844 })
    for (const window of await page.locator(".desk > .desk_wbox").all()) await expect(window).toBeVisible()
    await expect(page.locator(".desk > .desk_wbox .desk_wbox_body_text_input")).toBeVisible()
    await page.locator(".blog_media").screenshot({ path: ".cache/blog-media.png" })
    await page.goto("/ja/blogs/chaos-theory")
    await expect(page.getByRole("button", { name: "再生", exact: true })).toBeVisible()
    await expect(page.locator(".desk .blog_scene_heading h3")).toHaveText("試してみましょう")
})

test("1080p frame export produces a playable WebM with an Opus audio track", async ({ page }) => {
    const rate = 48000, samples = rate, wave = Buffer.alloc(44 + samples * 2)
    wave.write("RIFF", 0); wave.writeUInt32LE(wave.length - 8, 4); wave.write("WAVEfmt ", 8)
    wave.writeUInt32LE(16, 16); wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22)
    wave.writeUInt32LE(rate, 24); wave.writeUInt32LE(rate * 2, 28); wave.writeUInt16LE(2, 32); wave.writeUInt16LE(16, 34)
    wave.write("data", 36); wave.writeUInt32LE(samples * 2, 40)
    for (let i = 0; i < samples; i++) wave.writeInt16LE(Math.round(Math.sin(i * 440 * Math.PI * 2 / rate) * 4000), 44 + i * 2)
    await page.route("**/assets/media/scene-test.wav", route => route.fulfill({ contentType: "audio/wav", body: wave }))
    await page.route("**/assets/media/scene-test.svg", route => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="orange"/></svg>' }))
    await page.route("**/blogs/chaos-theory", async route => {
        const response = await route.fetch(), html = await response.text()
        const replaced = html.replace(/(<script type="application\/json" data-blog-timeline="">)([\s\S]*?)(<\/script>)/, (_, open, source, close) => {
            const timeline = JSON.parse(source)
            timeline.segments = [{ ...timeline.segments[0], duration: 1, start: 0, end: 1, audio: "/assets/media/scene-test.wav", image: "/assets/media/scene-test.svg" }]
            timeline.duration = 1
            return open + JSON.stringify(timeline).replace(/</g, "\\u003c") + close
        })
        await route.fulfill({ response, body: replaced })
    })
    await page.goto("/blogs/chaos-theory")
    const download = page.waitForEvent("download", { timeout: 120000 })
    void download.catch(() => {})
    await page.getByRole("button", { name: "Render 1080p video" }).click()
    await expect(page.locator("[data-blog-status]")).toHaveText(/Video ready|Could not render video:.*/, { timeout: 120000 })
    await expect(page.locator("[data-blog-status]")).toHaveText("Video ready")
    const file = await download
    const bytes = await readFile((await file.path())!)
    const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS })
    const video = await input.getPrimaryVideoTrack(), audio = await input.getPrimaryAudioTrack()
    expect(video?.displayWidth).toBe(1920); expect(video?.displayHeight).toBe(1080)
    expect(audio?.codec).toBe("opus")
    expect(await input.computeDuration()).toBeGreaterThanOrEqual(0.99)
    input.dispose()
    await expect(page.locator("[data-blog-status]")).toHaveText("Video ready")
    await page.getByRole("button", { name: "Render 1080p video" }).click()
    await page.getByRole("button", { name: "Cancel", exact: true }).click()
    await expect(page.locator("[data-blog-status]")).toHaveText("Render cancelled")
    await expect(page.getByRole("button", { name: "Render 1080p video" })).toBeEnabled()
})

test("unsupported encoders leave the reading view available", async ({ page }) => {
    await page.addInitScript(() => { Object.defineProperty(window, "VideoEncoder", { value: undefined, configurable: true }) })
    await page.goto("/blogs/chaos-theory")
    await page.getByRole("button", { name: "Render 1080p video" }).click()
    await expect(page.locator("[data-blog-status]")).toContainText("requires WebCodecs")
    await expect(page.locator(".desk .blog_scene_heading h2")).toBeVisible()
})

test("scene articles and authored source remain readable without JavaScript", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } })
    try {
        const page = await context.newPage()
        await page.goto("http://127.0.0.1:8124/blogs/chaos-theory")
        await expect(page.locator(".desk .blog_scene_heading h2")).toBeVisible()
        await expect(page.locator(".desk .blog_scene_heading h3")).toBeVisible()
        await expect(page.locator(".desk .desk_wbox_body_doc")).toContainText("logistic map")
        for (const window of await page.locator(".desk > .desk_wbox").all()) await expect(window).toBeVisible()
        await expect(page.locator(".blog_media")).toBeHidden()
    } finally { await context.close() }
})
