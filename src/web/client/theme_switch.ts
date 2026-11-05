import { deserialize, to_dom, type serialized_node } from "../vnode.tsx"
export type theme_options = { name: string, mode: string }

export type theme_handle = {
    fade_in(ms: number): Promise<void>
    fade_out(ms: number): Promise<void>
    pause(): void
    resume(): void
    dispose(): void
}

export type theme_module = {
    mount(root: HTMLElement, options: theme_options): theme_handle
}

type theme_manifest = Record<string, { css: string, js: string | null, label: string, background: serialized_node }>
type theme_window = Window & { jazu_theme_modules?: Record<string, theme_module> }
const scripts = new Map<string, Promise<theme_module>>()
function load_theme_module(url: string, name: string): Promise<theme_module> {
    const available = (window as theme_window).jazu_theme_modules?.[name]
    if (available) return Promise.resolve(available)
    if (!scripts.has(name)) scripts.set(name, new Promise((done, fail) => {
        const script = document.createElement("script")
        script.src = url
        script.onload = () => {
            const module = (window as theme_window).jazu_theme_modules?.[name]
            if (module) done(module)
            else { scripts.delete(name); fail(new Error("Theme module was not registered")) }
        }
        script.onerror = () => { scripts.delete(name); fail(new Error("Theme script failed to load")) }
        document.head.append(script)
    }))
    return scripts.get(name)!
}

const reduced = (): boolean => matchMedia("(prefers-reduced-motion: reduce)").matches

function wait(ms: number): Promise<void> {
    return new Promise(done => setTimeout(done, ms))
}

async function load_manifest(): Promise<theme_manifest> {
    const response = await fetch("/assets/themes/manifest.json")
    return (await response.json()) as theme_manifest
}

function load_css(href: string, name: string): Promise<void> {
    const existing = document.querySelector(`link[href="${href}"]`)
    if (existing) return Promise.resolve()
    return new Promise((done, fail) => {
        const link = document.createElement("link")
        link.rel = "stylesheet"
        link.dataset.themeCss = name
        link.href = href
        link.onload = () => done()
        link.onerror = () => fail(new Error(`theme css failed: ${href}`))
        document.head.append(link)
    })
}

function announce(text: string): void {
    const region = document.getElementById("spa_live")
    if (region) region.textContent = text
}

// Each theme brings its own background markup (the default has the globe svg and displacement filter, Memory only the layer its script fills).
// Replace the old theme's set so a theme never finds its markup missing when it is not the one the page was rendered with.
function swap_background(tree: serialized_node): void {
    const old = document.getElementById("theme_background")
    if (old) old.replaceWith(to_dom(deserialize(tree)))
}

// Two themes both declare @font-face "Jasouza", so an old theme's sheet must not stay loaded next to the new one.
function drop_other_themes(name: string): void {
    for (const link of document.querySelectorAll<HTMLLinkElement>("link[data-theme-css]")) {
        if (link.dataset.themeCss !== name) link.remove()
    }
}

let current: theme_handle | null = null

function set_mode(name: string, mode: string): void {
    document.documentElement.dataset.mode = mode
    try {
        localStorage.setItem("jazu_theme", name)
        localStorage.setItem("jazu_mode", mode)
    } catch { }
    announce(`Mode changed to ${mode}`)
}

export async function switch_theme(name: string, mode: string): Promise<void> {
    const root = document.documentElement
    // Same theme, only Auto / Light / Dark changed: the running theme script is bound to the current background layer, so replacing that
    // layer (swap_background) would leave it drawing on a detached canvas. The theme already repaints itself on the mode radios.
    if (root.dataset.theme === name) {
        set_mode(name, mode)
        return
    }
    const manifest = await load_manifest()
    const next = manifest[name]
    if (!next) return
    try {
        await load_css(next.css, name)
        await document.fonts.ready
    } catch {
        announce("Theme failed to load, staying on the current theme")
        return
    }
    const fade = reduced() ? 0 : 450
    // The theme the page was rendered with was started by its own <script type="module">, not by mount(), so there is no handle yet:
    // import() hands back that same module instance, and mount() is idempotent, so we get a handle to stop it.
    const previous = manifest[root.dataset.theme ?? ""]
    if (!current && previous?.js && root.dataset.theme !== name) {
        try {
            const old_module = await load_theme_module(previous.js, root.dataset.theme ?? "")
            const old_layer = document.querySelector<HTMLElement>(".background")
            if (old_layer && typeof old_module.mount === "function") current = old_module.mount(old_layer, { name: root.dataset.theme ?? "", mode })
        } catch { }
    }
    if (current) await current.fade_out(fade)
    current?.dispose()
    root.dataset.theme = name
    root.dataset.mode = mode
    swap_background(next.background)
    drop_other_themes(name)
    try {
        localStorage.setItem("jazu_theme", name)
        localStorage.setItem("jazu_mode", mode)
    } catch { }
    if (next.js) {
        const module = await load_theme_module(next.js, name)
        const layer = document.querySelector<HTMLElement>(".background")
        if (layer && typeof module.mount === "function") current = module.mount(layer, { name, mode })
        await current?.fade_in(fade)
    } else {
        await wait(fade)
    }
    announce(`Theme changed to ${next.label}`)
}

export function switch_from_dom(): void {
    const mode = document.querySelector<HTMLInputElement>('input[name="theme_state"]:checked')?.value ?? "auto"
    const name = document.querySelector<HTMLInputElement>('input[name="theme_name"]:checked')?.value ?? document.documentElement.dataset.theme ?? "default"
    void switch_theme(name, mode)
}

; (window as Window & { jazu_theme_switch?: unknown }).jazu_theme_switch = { switch_theme, switch_from_dom }
