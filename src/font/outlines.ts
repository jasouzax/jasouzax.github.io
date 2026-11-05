import svg_path from "svgpath"

export type point = { x: number, y: number }
export type outline = { contours: point[][], bounds: [number, number, number, number] }

// Flatten curves adaptively in authoring units, then quantize once to TrueType
// coordinates. No automatic scaling: the authored cell is the em square.
export function outline_of(paths: string[], height: number): outline {
    const contours: point[][] = []
    let current: point[] = []
    const add = (x: number, y: number) => { current.push({ x: Math.round(x), y: Math.round(height - y) }) }
    const finish = () => {
        current = current.filter((p, i) => i === 0 || p.x !== current[i - 1].x || p.y !== current[i - 1].y)
        if (current.length > 1 && current[0].x === current.at(-1)!.x && current[0].y === current.at(-1)!.y) current.pop()
        if (current.length >= 3) contours.push(current)
        current = []
    }
    const cubic = (a: point, b: point, c: point, d: point, depth = 0): void => {
        const distance = (p: point) => {
            const dx = d.x - a.x, dy = d.y - a.y
            return Math.abs(dy * p.x - dx * p.y + d.x * a.y - d.y * a.x) / (Math.hypot(dx, dy) || 1)
        }
        if (depth >= 14 || Math.max(distance(b), distance(c), Math.hypot(d.x - a.x, d.y - a.y) < .01 ? Math.hypot(b.x - a.x, b.y - a.y) : 0) <= .2) { add(d.x, d.y); return }
        const mid = (p: point, q: point): point => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 })
        const ab = mid(a, b), bc = mid(b, c), cd = mid(c, d), abc = mid(ab, bc), bcd = mid(bc, cd), center = mid(abc, bcd)
        cubic(a, ab, abc, center, depth + 1); cubic(center, bcd, cd, d, depth + 1)
    }
    for (const source of paths.filter(Boolean)) {
        const path = svg_path(source).abs().unshort().unarc()
        if ((path as unknown as { err: string }).err) throw new Error(`Invalid glyph path: ${(path as unknown as { err: string }).err}`)
        path.iterate((segment, _index, x, y) => {
            const values = segment.slice(1) as number[]
            switch (segment[0].toUpperCase()) {
                case "M": finish(); add(values[0], values[1]); break
                case "L": add(values[0], values[1]); break
                case "H": add(values[0], y); break
                case "V": add(x, values[0]); break
                case "C": cubic({ x, y }, { x: values[0], y: values[1] }, { x: values[2], y: values[3] }, { x: values[4], y: values[5] }); break
                case "Q": {
                    const [cx, cy, ex, ey] = values
                    cubic({ x, y }, { x: x + 2 * (cx - x) / 3, y: y + 2 * (cy - y) / 3 }, { x: ex + 2 * (cx - ex) / 3, y: ey + 2 * (cy - ey) / 3 }, { x: ex, y: ey }); break
                }
                case "Z": finish(); break
                default: throw new Error(`Unsupported glyph path command ${segment[0]}`)
            }
        })
        finish()
    }
    const points = contours.flat()
    if (points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) > 32767 || Math.abs(p.y) > 32767)) throw new Error("Glyph coordinates exceed TrueType limits")
    const bounds: outline["bounds"] = points.length ? [Math.min(...points.map(p => p.x)), Math.min(...points.map(p => p.y)), Math.max(...points.map(p => p.x)), Math.max(...points.map(p => p.y))] : [0, 0, 0, 0]
    return { contours, bounds }
}
