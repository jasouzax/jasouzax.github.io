/* Deterministic route matching: static segments, parameters, then a final wildcard. Decode each segment once. */
export function route_segments(path: string, pattern = false): string[] {
    if (typeof path !== "string" || path.length > 2048 || !path.startsWith("/")) throw new Error("API paths must start with /")
    const parts = path === "/" ? [] : path.replace(/\/$/, "").slice(1).split("/")
    const names = new Set<string>()
    return parts.map((value, index) => {
        const part = pattern ? value : decodeURIComponent(value)
        if (!part || [".", ".."].includes(part) || /[\\/\0]/.test(part)) throw new Error("Invalid API path segment")
        if (pattern && /^[*:]/.test(part) && (!/^[*:][a-zA-Z][a-zA-Z0-9_]*$/.test(part) || part.startsWith("*") && index !== parts.length - 1 || ["__proto__", "constructor", "prototype"].includes(part.slice(1)))) throw new Error("Invalid API route parameter")
        if (pattern && /[%?#]/.test(part)) throw new Error("Route patterns use decoded literal segments")
        if (pattern && /^[*:]/.test(part)) { if (names.has(part.slice(1))) throw new Error("API route parameter names must be unique"); names.add(part.slice(1)) }
        return part
    })
}
export function match_route(pattern: string[], path: string[]): Record<string, string> | null {
    const params: Record<string, string> = Object.create(null)
    let index = 0
    for (const segment of pattern) {
        if (segment.startsWith("*")) { params[segment.slice(1)] = path.slice(index).join("/"); return params }
        if (index >= path.length) return null
        if (segment.startsWith(":")) params[segment.slice(1)] = path[index]
        else if (segment !== path[index]) return null
        index++
    }
    return index === path.length ? params : null
}
export function route_order(a: string[], b: string[]): number {
    const weight = (part?: string) => part === undefined ? 4 : part.startsWith("*") ? 1 : part.startsWith(":") ? 2 : 3
    for (let index = 0; index < Math.max(a.length, b.length); index++) { const difference = weight(b[index]) - weight(a[index]); if (difference) return difference }
    return 0
}
