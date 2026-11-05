import { plugin_matches, select_case, type plugin_info, type plugin_case } from "../../plugin_types.ts"
import type { desk_window, state as desk_state } from "./desk.ts"

export type plugin_host = {
    code: (item: desk_window, hex_mode?: boolean) => HTMLElement
    media: (item: desk_window) => HTMLElement
    terminal: (item: desk_window) => HTMLElement | null
    fallback: (item: desk_window) => HTMLElement
    markdown: (item: desk_window, signal: AbortSignal) => HTMLElement
    state: typeof desk_state
    text: (key: string) => string
    render_window: (item: desk_window) => void
    save_window: (item: desk_window) => Promise<void>
}

export type plugin_context = {
    item: desk_window
    plugin: plugin_info
    host: plugin_host
    signal: AbortSignal
    load_wasm: () => Promise<WebAssembly.Module>
    case?: plugin_case
}
export type plugin_module = {
    matches?: (context: plugin_context) => boolean
    render?: (context: plugin_context) => HTMLElement | null
    setup?: (context: plugin_context) => void | (() => void)
}

let registry: Promise<plugin_info[]> | null = null
const modules = new Map<string, Promise<plugin_module>>()
const wasm = new Map<string, Promise<WebAssembly.Module>>()

export function plugin_registry(): Promise<plugin_info[]> {
    return registry ??= fetch("/assets/plugins.json").then(async response => {
        if (!response.ok) throw new Error(`Plugins: ${response.status}`)
        return response.json()
    })
}

function load_module(url: string): Promise<plugin_module> {
    if (!modules.has(url)) modules.set(url, import(url))
    return modules.get(url)!
}

async function load_wasm(plugin: plugin_info): Promise<WebAssembly.Module> {
    if (!plugin.wasm || !plugin.sha256) throw new Error("Plugin has no WASM integrity declaration")
    const key = plugin.wasm + plugin.sha256
    if (!wasm.has(key)) wasm.set(key, (async () => {
        const response = await fetch(plugin.wasm!)
        if (!response.ok) throw new Error(`WASM: ${response.status}`)
        const bytes = await response.arrayBuffer()
        const digest = await crypto.subtle.digest("SHA-256", bytes)
        const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("")
        if (hash !== plugin.sha256!.toLowerCase()) throw new Error("Plugin WASM integrity mismatch")
        return WebAssembly.compile(bytes)
    })())
    return wasm.get(key)!
}

// XML order resolves ties; Default is always the last fallback. Scripts can refine a
// trigger, install desk contributions, and release them when the body is replaced.
export async function prepare_plugins(item: desk_window, host: plugin_context["host"], signal: AbortSignal): Promise<{ context: plugin_context, module: plugin_module }[]> {
    const plugins = await plugin_registry()
    const candidates = plugins.filter(plugin => plugin_matches(plugin, item))
        .sort((a, b) => Number(a.id === "default") - Number(b.id === "default"))
    const result = []
    for (const plugin of candidates) {
        if (signal.aborted) break
        try {
            const entry = plugin.cases?.length ? select_case(plugin.cases, item) : undefined
            if (entry === null) continue
            const script = entry?.script ?? plugin.script
            const module = script ? { ...await load_module(script) } : {}
            const context = { item, host, signal, plugin, case: entry, load_wasm: () => load_wasm(plugin) }
            // A script can override the host renderer or only add custom actions.
            if (!module.render && entry?.host) module.render = context => render_host(entry.host!, context)
            if (!module.render && !module.setup) continue
            if (!signal.aborted && (!module.matches || module.matches(context))) result.push({ context, module })
        } catch (error) {
            console.warn(`Plugin ${plugin.id} failed to load`, error)
        }
    }
    return result
}

function render_host(name: NonNullable<plugin_case["host"]>, { item, host, signal }: plugin_context): HTMLElement | null {
    switch (name) {
        case "text": return host.code(item)
        case "hex": return host.code(item, true)
        case "media": return host.media(item)
        case "shell": return host.terminal(item)
        case "markdown": return host.markdown(item, signal)
        case "default": return host.fallback(item)
    }
}
