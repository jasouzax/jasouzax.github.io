import { deserialize, to_dom, type serialized_node } from "../vnode.tsx"
import { begin_loading, finish_loading, motion_reduced, wait_resources } from "./loading.ts"
import { sync_theme_radios } from "./menus.ts"

export type theme_options = { name: string, mode: string }
export type theme_handle = {
    fade_in(ms: number): Promise<void>
    fade_out(ms: number): Promise<void>
    pause(): void
    resume(): void
    dispose(): void
}
export type theme_module = { mount(root: HTMLElement, options: theme_options): theme_handle }
type theme_manifest = Record<string, { css: string, js: string | null, label: string, colors?: [string, string], background: serialized_node }>
type theme_window = Window & { jazu_theme_modules?: Record<string, theme_module> }
const scripts = new Map<string, Promise<theme_module>>()

function load_theme_module(url: string, name: string): Promise<theme_module> {
    const available = (window as theme_window).jazu_theme_modules?.[name]
    if (available) return Promise.resolve(available)
    if (!scripts.has(name)) scripts.set(name, new Promise((done, fail) => {
        const script = document.createElement("script")
        const timer = setTimeout(() => { script.remove(); scripts.delete(name); fail(new Error("Theme script timed out")) }, 8000)
        script.src = url
        script.onload = () => {
            clearTimeout(timer)
            const module = (window as theme_window).jazu_theme_modules?.[name]
            if (module) done(module)
            else { scripts.delete(name); fail(new Error("Theme module was not registered")) }
        }
        script.onerror = () => { clearTimeout(timer); script.remove(); scripts.delete(name); fail(new Error("Theme script failed to load")) }
        document.head.append(script)
    }))
    return scripts.get(name)!
}

async function load_manifest(): Promise<theme_manifest> {
    const response = await fetch("/assets/themes/manifest.json", { signal: AbortSignal.timeout(5000) })
    if (!response.ok) throw new Error("Theme manifest failed to load")
    return await response.json() as theme_manifest
}

function load_css(href: string, name: string): Promise<HTMLLinkElement> {
    const existing = Array.from(document.querySelectorAll<HTMLLinkElement>("link[data-theme-css]"))
        .find(link => link.getAttribute("href") === href && !link.dataset.failed)
    if (existing?.sheet) return Promise.resolve(existing)
    return new Promise((done, fail) => {
        const link = existing ?? document.createElement("link")
        const timer = setTimeout(() => { if (!existing) link.remove(); fail(new Error("Theme CSS timed out")) }, 8000)
        link.rel = "stylesheet"
        link.dataset.themeCss = name
        link.href = href
        if (!existing) link.media = "print"
        link.onload = () => { clearTimeout(timer); done(link) }
        link.onerror = () => { clearTimeout(timer); if (!existing) link.remove(); fail(new Error("Theme CSS failed to load")) }
        if (!existing) document.head.append(link)
    })
}

function announce(text: string): void {
    let region = document.getElementById("spa_live")
    if (!region) {
        region = document.createElement("div")
        region.id = "spa_live"
        region.className = "visually_hidden"
        region.setAttribute("aria-live", "polite")
        document.body.append(region)
    }
    region.textContent = text
}

function save_choice(name: string, mode: string): void {
    try {
        localStorage.setItem("jazu_theme", name)
        localStorage.setItem("jazu_mode", mode)
    } catch {}
}

let current: theme_handle | null = null
let queue: Promise<void> = Promise.resolve()

async function apply_theme(name: string, mode: string): Promise<void> {
    if (!["auto", "light", "dark"].includes(mode)) mode = "auto"
    const root = document.documentElement
    const previous_name = root.dataset.theme ?? "default", previous_mode = root.dataset.mode ?? "auto"
    if (name === previous_name && mode === previous_mode) return
    // Modes use the current theme's loaded resources and running renderer.
    // Keep this outside the loading lifecycle, including its finally block.
    if (name === previous_name) {
        root.dataset.mode = mode
        sync_theme_radios()
        save_choice(name, mode)
        announce(`Mode changed to ${mode}`)
        return
    }
    begin_loading("theme")
    const previous_background = document.getElementById("theme_background")!
    const previous_links = [...document.querySelectorAll<HTMLLinkElement>("link[data-theme-css]")]
    let next_link: HTMLLinkElement | null = null
    let swapped = false
    try {
        const manifest = await load_manifest(), next = manifest[name], previous = manifest[previous_name]
        if (!next) throw new Error("Unknown theme")
        if (!current && previous?.js) {
            const module = await load_theme_module(previous.js, previous_name)
            const layer = previous_background.querySelector<HTMLElement>(".background")
            if (layer) current = module.mount(layer, { name: previous_name, mode: previous_mode })
        }
        await current?.fade_out(motion_reduced() ? 0 : 160)
        current?.pause()
        root.dataset.theme = ""
        root.dataset.mode = mode
        next_link = await load_css(next.css, name)
        // Font-face names overlap. Keep the removed nodes for exact rollback.
        for (const link of previous_links) if (link !== next_link) link.remove()
        next_link.media = "all"
        current?.dispose()
        current = null
        previous_background.replaceWith(to_dom(deserialize(next.background)))
        swapped = true
        root.dataset.theme = name
        sync_theme_radios()
        if (next.js) {
            const module = await load_theme_module(next.js, name)
            const layer = document.querySelector<HTMLElement>("#theme_background .background")
            if (layer) current = module.mount(layer, { name, mode })
        }
        await wait_resources()
        await current?.fade_in(motion_reduced() ? 0 : 320)
        if (next.colors) {
            for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
                meta.content = next.colors[meta.media.includes("dark") ? 1 : 0]
            }
        }
        save_choice(name, mode)
        announce(`Theme changed to ${next.label}`)
    } catch {
        if (swapped) {
            current?.dispose()
            current = null
            document.getElementById("theme_background")?.replaceWith(previous_background)
        }
        if (next_link && !previous_links.includes(next_link)) next_link.remove()
        for (const link of previous_links) if (!link.isConnected) document.head.append(link)
        root.dataset.theme = previous_name
        root.dataset.mode = previous_mode
        if (swapped) {
            const module = (window as theme_window).jazu_theme_modules?.[previous_name]
            const layer = previous_background.querySelector<HTMLElement>(".background")
            if (module && layer) current = module.mount(layer, { name: previous_name, mode: previous_mode })
        } else current?.resume()
        sync_theme_radios()
        announce("Theme failed to load, staying on the current theme")
    } finally {
        await finish_loading("theme")
    }
}

export function switch_theme(name: string, mode: string): Promise<void> {
    // Serialize changes so a late download cannot overwrite a newer selection.
    const task = queue.then(() => apply_theme(name, mode))
    queue = task.catch(() => {})
    return task
}

export function switch_from_dom(): void {
    const mode = document.querySelector<HTMLInputElement>('input[name="theme_state"]:checked')?.value ?? "auto"
    const name = document.querySelector<HTMLInputElement>('input[name="theme_name"]:checked')?.value ?? document.documentElement.dataset.theme ?? "default"
    void switch_theme(name, mode)
}

;(window as Window & { jazu_theme_switch?: unknown }).jazu_theme_switch = { switch_theme, switch_from_dom }
