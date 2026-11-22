/** Browser-local map placement. Invalid/stale records never prevent a map from opening. */
export type Node_Positions = Record<string, { x: number, y: number }>

export function read_positions(key: string): Node_Positions {
    try {
        const data: unknown = JSON.parse(localStorage.getItem(key) ?? "{}")
        if (!data || typeof data !== "object" || Array.isArray(data)) return {}
        return Object.fromEntries(Object.entries(data).filter(([, value]) => value && typeof value.x === "number" && Number.isFinite(value.x) && typeof value.y === "number" && Number.isFinite(value.y)).slice(0, 1000))
    } catch { return {} }
}

export function save_positions(key: string, positions: Node_Positions): void {
    try { localStorage.setItem(key, JSON.stringify(positions)) } catch { /* positions still last for this page in private/quota-limited browsers */ }
}
