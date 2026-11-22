/** Pure map contracts and deterministic layouts. Coordinates are in CSS pixels, independent of zoom. */
export type Map_Node = { id: string, name: string, info?: string, icon?: string, link?: string, parent?: string, x?: number, y?: number, active?: boolean, hidden?: boolean }
export type Map_Edge = { from: string, to: string, text?: string }
export type Map_Graph = { nodes: Map_Node[], edges: Map_Edge[] }
export type Placed_Node = Map_Node & { x: number, y: number }

export function place_nodes(graph: Map_Graph, layout: string): Placed_Node[] {
    const by_id = new Map(graph.nodes.map(node => [node.id, node]))
    const depth = (node: Map_Node): number => {
        const seen = new Set([node.id])
        let parent = node.parent, level = 0
        while (parent && by_id.has(parent) && !seen.has(parent)) {
            seen.add(parent)
            level++
            parent = by_id.get(parent)?.parent
        }
        return level
    }
    const lanes = new Map<number, number>()
    const columns = Math.max(1, Math.ceil(Math.sqrt(graph.nodes.length)))
    return graph.nodes.map((node, index) => {
        const level = depth(node)
        const row = lanes.get(level) ?? 0
        lanes.set(level, row + 1)
        const x = layout === "tree" ? level * 280 : layout === "flow" ? index * 280 : (index % columns) * 280
        const y = layout === "tree" ? row * 130 : layout === "flow" ? level * 130 : Math.floor(index / columns) * 130
        return { ...node, x: Number.isFinite(node.x) ? node.x! : x + 30, y: Number.isFinite(node.y) ? node.y! : y + 30 }
    })
}

export function zoom_at(view: { x: number, y: number, scale: number }, factor: number, x: number, y: number): { x: number, y: number, scale: number } {
    const scale = Math.min(3, Math.max(.2, view.scale * factor))
    const ratio = scale / view.scale
    return { x: x - (x - view.x) * ratio, y: y - (y - view.y) * ratio, scale }
}
