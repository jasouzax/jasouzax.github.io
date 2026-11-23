/** Desk map controller: active-menu selection, resource graph, accessible navigation and pan/zoom.
 * Authored fallback stays in its menu. Runtime graph DOM is rebuilt only when the graph changes.
 * Each desk owns its observers/listeners; dispose releases them before SPA navigation.
 */
import { state, text, label_of, arrange, focus_window, new_window } from "../index.ts"
import { open_source } from "../window/index.ts"
import { kernel, subscribe_processes } from "../kernel/process.ts"
import { flow_kind_of } from "../plugin/flow.ts"
import { place_nodes, zoom_at, type Map_Graph } from "./map/model.ts"
import { read_positions, save_positions, type Node_Positions } from "./map/positions.ts"
import { map_image_icon } from "../../shared/content/tags/map.ts"

type Map_Source = () => Map_Graph
const sources = new Set<Map_Source>()
let current: { mode: (on: boolean) => void, refresh: () => void } | null = null

export function register_map_resources(source: Map_Source, signal?: AbortSignal): () => void {
    if (signal?.aborted) return () => {}
    sources.add(source)
    current?.refresh()
    const dispose = () => { sources.delete(source); signal?.removeEventListener("abort", dispose); current?.refresh() }
    signal?.addEventListener("abort", dispose, { once: true })
    return dispose
}

export function show_windows(): void {
    if (state.desk?.dataset.displayMode === "map") current?.mode(false)
}

function numeric(value: string | undefined): number | undefined {
    return value?.trim() && Number.isFinite(Number(value)) ? Number(value) : undefined
}

function manual_graph(map: HTMLElement): Map_Graph {
    const graph: Map_Graph = {
        nodes: [...map.querySelectorAll<HTMLElement>("[data-map-node]")].map(node => ({
            id: node.dataset.mapNode!, name: (node.querySelector(":scope > .desk_map_label > .desk_map_name") ?? node.querySelector(":scope > .desk_map_label"))?.textContent?.trim() ?? node.dataset.mapNode!,
            info: node.querySelector(":scope > p")?.textContent ?? "", link: node.querySelector(":scope > .desk_map_label a")?.getAttribute("href") ?? undefined,
            icon: node.querySelector(":scope > .desk_map_label > .desk_map_icon")?.getAttribute("src") ?? node.querySelector(":scope > .desk_map_label > .desk_map_icon")?.textContent ?? undefined,
            parent: node.dataset.mapParent, x: numeric(node.dataset.mapX), y: numeric(node.dataset.mapY),
        })),
        edges: [...map.querySelectorAll<HTMLElement>("[data-map-from]")].map(edge => ({ from: edge.dataset.mapFrom!, to: edge.dataset.mapTo!, text: edge.dataset.mapText })),
    }
    for (const node of graph.nodes) if (node.parent && !graph.edges.some(edge => edge.from === node.parent && edge.to === node.id)) graph.edges.push({ from: node.parent, to: node.id })
    return graph
}

function auto_graph(page: HTMLElement): Map_Graph {
    const graph: Map_Graph = { nodes: [], edges: [] }
    const entries = page.dataset.path === "desk:windows" ? [] : [...page.querySelectorAll<HTMLElement>(".desk_side_item")]
    const entry_id = (entry: HTMLElement) => `entry:${entry.dataset.path ?? entry.dataset.entryId ?? entries.indexOf(entry)}`
    for (const entry of entries) {
        const head = entry.querySelector(":scope > details > summary, :scope > summary") ?? entry.querySelector(".desk_side_item_head")
        const link = head?.querySelector<HTMLAnchorElement>("a")
        const parent = entry.parentElement?.closest<HTMLElement>(".desk_side_item")
        const id = entry_id(entry)
        const parent_id = parent ? entry_id(parent) : undefined
        graph.nodes.push({ id, name: head?.querySelector(".desk_side_item_name")?.textContent?.trim() || link?.textContent || id, link: link?.getAttribute("href") ?? (entry.dataset.path ? `file://${entry.dataset.path}` : undefined), parent: parent_id })
        if (parent_id) graph.edges.push({ from: parent_id, to: id })
    }
    for (const item of state.windows) {
        const id = `window:${item.id}`
        graph.nodes.push({ id, name: label_of(item), info: item.path || item.mime, link: id, icon: item.icon, active: item === state.focused, hidden: item.minimized || item.hidden, parent: item.parent ? `window:${item.parent.id}` : undefined })
        if (item.parent) {
            const flow = flow_kind_of(item)
            if (flow) {
                const flow_id = `flow:${item.parent.id}:${item.id}`
                graph.nodes.push({ id: flow_id, name: flow, info: `${item.parent.mime} → ${item.mime}`, link: id, parent: `window:${item.parent.id}` })
                graph.edges.push({ from: `window:${item.parent.id}`, to: flow_id }, { from: flow_id, to: id })
            } else graph.edges.push({ from: `window:${item.parent.id}`, to: id })
        }
        if (item.pid !== null) graph.edges.push({ from: `pid:${item.pid}`, to: id })
    }
    for (const proc of kernel.table.values()) {
        if (!proc.running && !state.windows.some(item => item.pid === proc.pid)) continue
        graph.nodes.push({ id: `pid:${proc.pid}`, name: proc.argv.join(" ") || `pid:${proc.pid}`, info: `pid:${proc.pid}`, link: `pid:${proc.pid}`, hidden: !state.windows.some(item => item.pid === proc.pid), parent: proc.ppid ? `pid:${proc.ppid}` : undefined })
        if (proc.ppid) graph.edges.push({ from: `pid:${proc.ppid}`, to: `pid:${proc.pid}` })
    }
    for (const source of sources) {
        try {
            const contributed = source()
            graph.nodes.push(...contributed.nodes.filter(node => typeof node.id === "string" && typeof node.name === "string"))
            graph.edges.push(...contributed.edges.filter(edge => typeof edge.from === "string" && typeof edge.to === "string"))
        } catch (error) { console.warn("Map resource provider failed", error) }
    }
    graph.nodes = [...new Map(graph.nodes.map(node => [node.id, node])).values()]
    return graph
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, class_name: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag)
    node.className = class_name
    return node
}

export function init_map(desk: HTMLElement): () => void {
    const side = desk.querySelector<HTMLElement>(".desk_side")!
    const button = side?.querySelector<HTMLButtonElement>(".desk_side_mode")
    if (!side || !button) return () => {}
    const abort = new AbortController(), signal = abort.signal
    const viewport = element("section", "desk_map_view")
    viewport.id = "desk_map_view"
    viewport.hidden = true
    viewport.setAttribute("aria-label", text("desk_map"))
    const tools = element("div", "desk_map_tools")
    const surface = element("div", "desk_map_surface")
    surface.tabIndex = 0
    surface.setAttribute("aria-label", text("desk_map"))
    const canvas = element("div", "desk_map_canvas")
    surface.append(canvas)
    viewport.append(tools, surface)
    desk.append(viewport)
    button.setAttribute("aria-controls", viewport.id)
    let active_map: HTMLElement | null = null, active_page: HTMLElement | null = null
    let view = { x: 0, y: 0, scale: 1 }, graph_key = ""
    let positions: Node_Positions = {}, positions_key = ""
    const views = new WeakMap<HTMLElement, typeof view>()
    const transform = () => { canvas.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }
    const zoom = (factor: number, x = surface.clientWidth / 2, y = surface.clientHeight / 2) => { view = zoom_at(view, factor, x, y); transform() }
    for (const [key, label, action] of [
        ["out", "map_zoom_out", () => zoom(1 / 1.2)], ["in", "map_zoom_in", () => zoom(1.2)],
        ["reset", "map_reset", () => { view = { x: 0, y: 0, scale: 1 }; transform() }],
    ] as const) {
        const control = element("button", "desk_map_tool")
        control.type = "button"
        control.dataset.mapAction = key
        control.textContent = text(label)
        control.addEventListener("click", action, { signal })
        tools.append(control)
    }
    function render(): void {
        if (!active_map || !active_page || viewport.hidden) return
        const graph = active_map.hasAttribute("data-map-auto") ? auto_graph(active_page) : manual_graph(active_map)
        for (const node of graph.nodes) {
            const match = /^window:(\d+)$/.exec(node.link ?? "")
            if (match) node.active = state.focused?.id === Number(match[1])
        }
        const key = JSON.stringify(graph) + active_map.dataset.mapLayout
        if (key === graph_key) return
        graph_key = key
        const focused_id = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>("[data-map-id]")?.dataset.mapId
        const nodes = place_nodes(graph, active_map.dataset.mapLayout ?? "tree").map(node => ({ ...node, ...positions[node.id] }))
        const by_id = new Map(nodes.map(node => [node.id, node]))
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
        svg.classList.add("desk_map_edges")
        svg.setAttribute("aria-hidden", "true")
        for (const edge of graph.edges) {
            const from = by_id.get(edge.from), to = by_id.get(edge.to)
            if (!from || !to) continue
            const line = document.createElementNS(svg.namespaceURI, "path")
            const x = from.x + 220, y = from.y + 40, end_x = to.x, end_y = to.y + 40
            line.setAttribute("d", `M${x},${y} L${end_x},${end_y} m-8,-5 l8,5 l-8,5`)
            svg.append(line)
            if (edge.text) {
                const label = document.createElementNS(svg.namespaceURI, "text")
                label.setAttribute("x", String((x + end_x) / 2)); label.setAttribute("y", String((y + end_y) / 2 - 6))
                label.textContent = edge.text
                svg.append(label)
            }
        }
        canvas.replaceChildren(svg)
        for (const node of nodes) {
            const card = element("div", "desk_map_node")
            if (!node.link) card.tabIndex = 0
            card.dataset.mapId = node.id
            card.toggleAttribute("data-active", Boolean(node.active))
            card.toggleAttribute("data-hidden-resource", Boolean(node.hidden))
            card.style.left = `${node.x}px`; card.style.top = `${node.y}px`
            const label = element(node.link ? "a" : "span", "desk_map_node_name")
            label.textContent = node.name
            if (node.icon) {
                const image = map_image_icon(node.icon)
                const icon = element(image ? "img" : "span", "desk_map_icon")
                icon.setAttribute("aria-hidden", "true")
                if (icon instanceof HTMLImageElement) { icon.src = node.icon; icon.alt = "" }
                else icon.textContent = node.icon
                card.append(icon)
            }
            if (label instanceof HTMLAnchorElement) label.href = safe_link(node.link!)
            card.append(label)
            if (node.info) { const info = element("p", "desk_map_node_info"); info.textContent = node.info; card.append(info) }
            canvas.append(card)
            if (node.id === focused_id) label.focus({ preventScroll: true })
        }
    }
    function mode(on: boolean): void {
        const show = on && !!active_map
        desk.dataset.displayMode = show ? "map" : "window"
        viewport.hidden = !show
        button!.setAttribute("aria-pressed", String(show))
        const label = text(show ? "desk_windows" : "desk_map")
        if (button!.textContent !== label) button!.textContent = label
        arrange()
        render()
    }
    function sync(): void {
        const tabs = [...side.querySelectorAll<HTMLDetailsElement>(".desk_side_tabs_drop")]
        const index = tabs.findIndex(tab => tab.open)
        const pages = [...side.querySelectorAll<HTMLElement>(":scope > .desk_side_page")]
        pages.forEach((page, i) => { page.hidden = i !== index; page.style.display = i === index ? "block" : "none" })
        const page = pages[index] ?? null, map = page?.querySelector<HTMLElement>(".desk_map") ?? null
        if (map !== active_map) {
            if (active_map) views.set(active_map, { ...view })
            active_map = map
            active_page = page
            graph_key = ""
            positions_key = `jazu:map:${location.pathname}:${page?.dataset.path ?? index}`
            positions = Object.assign(Object.create(null), map?.hasAttribute("data-map-readonly") ? {} : read_positions(positions_key))
            view = (map && views.get(map)) || { x: 0, y: 0, scale: 1 }
            transform()
        }
        button!.hidden = !map
        viewport.toggleAttribute("data-map-readonly", Boolean(map?.hasAttribute("data-map-readonly")))
        mode(desk.dataset.displayMode === "map")
    }
    button.addEventListener("click", () => {
        mode(desk.dataset.displayMode !== "map")
        if (matchMedia("(orientation: portrait)").matches) document.getElementById("head_menu")?.removeAttribute("open")
    }, { signal })
    surface.addEventListener("wheel", event => {
        event.preventDefault()
        const rect = surface.getBoundingClientRect()
        zoom(Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * .002), event.clientX - rect.left, event.clientY - rect.top)
    }, { signal, passive: false })
    surface.addEventListener("keydown", event => {
        const card = (event.target as Element).closest<HTMLElement>("[data-map-id]")
        if (card && event.shiftKey && event.key.startsWith("Arrow")) {
            event.preventDefault()
            if (active_map?.hasAttribute("data-map-readonly")) return
            const id = card.dataset.mapId!, x = parseFloat(card.style.left), y = parseFloat(card.style.top)
            positions[id] = { x: x + (event.key === "ArrowLeft" ? -10 : event.key === "ArrowRight" ? 10 : 0), y: y + (event.key === "ArrowUp" ? -10 : event.key === "ArrowDown" ? 10 : 0) }
            graph_key = ""; render(); save_positions(positions_key, positions)
            return
        }
        if (event.target !== surface) return
        if (["+", "=", "-", "0"].includes(event.key)) {
            event.preventDefault()
            if (event.key === "0") { view = { x: 0, y: 0, scale: 1 }; transform() }
            else zoom(event.key === "-" ? 1 / 1.2 : 1.2)
        } else if (event.key.startsWith("Arrow")) {
            event.preventDefault()
            view.x += event.key === "ArrowLeft" ? 40 : event.key === "ArrowRight" ? -40 : 0
            view.y += event.key === "ArrowUp" ? 40 : event.key === "ArrowDown" ? -40 : 0
            transform()
        }
    }, { signal })
    let drag: { id: number, x: number, y: number, node?: string, node_x: number, node_y: number } | null = null
    surface.addEventListener("pointerdown", event => {
        if (event.button !== 0 || (event.target as Element).closest("a, button")) return
        const card = (event.target as Element).closest<HTMLElement>("[data-map-id]")
        if (card && active_map?.hasAttribute("data-map-readonly")) return
        drag = { id: event.pointerId, x: event.clientX, y: event.clientY, node: card?.dataset.mapId, node_x: card ? parseFloat(card.style.left) : 0, node_y: card ? parseFloat(card.style.top) : 0 }
        surface.setPointerCapture(event.pointerId)
        surface.focus({ preventScroll: true })
    }, { signal })
    surface.addEventListener("pointermove", event => {
        if (!drag || drag.id !== event.pointerId) return
        if (drag.node) {
            drag.node_x += (event.clientX - drag.x) / view.scale
            drag.node_y += (event.clientY - drag.y) / view.scale
            positions[drag.node] = { x: drag.node_x, y: drag.node_y }
            graph_key = ""; render()
        } else { view.x += event.clientX - drag.x; view.y += event.clientY - drag.y }
        drag.x = event.clientX; drag.y = event.clientY
        transform()
    }, { signal })
    surface.addEventListener("lostpointercapture", () => { if (drag?.node) save_positions(positions_key, positions); drag = null }, { signal })
    surface.addEventListener("pointerup", event => {
        if (drag?.node) save_positions(positions_key, positions)
        if (surface.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId)
        drag = null
    }, { signal })
    viewport.addEventListener("click", event => {
        const link = (event.target as Element).closest<HTMLAnchorElement>("a")
        if (!link || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
        const uri = link.getAttribute("href") ?? ""
        const match = /^window:(\d+)$/.exec(uri)
        if (match) {
            event.preventDefault()
            const item = state.windows.find(item => item.id === Number(match[1]))
            if (item) { mode(false); focus_window(item); item.el.focus({ preventScroll: true }) }
        } else if (/^(?:pid:|file:\/\/|im:)/.test(uri)) {
            event.preventDefault()
            mode(false)
            const pid = /^pid:(\d+)$/.exec(uri)
            const existing = pid ? state.windows.find(item => item.pid === Number(pid[1])) : null
            if (existing) { focus_window(existing); existing.el.focus({ preventScroll: true }); return }
            const item = new_window()
            if (item) void open_source(item, uri)
        }
    }, { signal })
    const observer = new MutationObserver(sync)
    observer.observe(side, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["open"] })
    let pending = false
    const refresh = () => {
        if (pending) return
        pending = true
        queueMicrotask(() => { pending = false; if (!signal.aborted) render() })
    }
    const unsubscribe = subscribe_processes(refresh)
    const controller = { mode, refresh: render }
    current = controller
    document.addEventListener("jazu:desk:change", refresh, { signal })
    desk.setAttribute("data-map-ready", "")
    sync()
    if (desk.hasAttribute("data-map-initial")) mode(true)
    return () => {
        abort.abort(); observer.disconnect(); unsubscribe(); viewport.remove()
        desk.removeAttribute("data-map-ready")
        if (current === controller) current = null
    }
}

function safe_link(link: string): string {
    try { return ["http:", "https:", "file:", "window:", "pid:", "im:"].includes(new URL(link, location.href).protocol) ? link : "#" } catch { return "#" }
}
