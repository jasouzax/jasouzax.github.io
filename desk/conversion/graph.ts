/** Executable MIME graph. Breadth-first search prefers direct routes and never revisits a MIME. */
export type Options = Record<string, string>
export type Field = { key: string, label: string, value: string, type?: "number" | "text", min?: string, max?: string, step?: string }
export type Converter = { id: string, from: string, to: string, extension: string, fields?: Field[], run: (file: Blob, options: Options, signal: AbortSignal) => Promise<Blob> }
export const normalize_mime = (mime: string): string => mime.split(";", 1)[0].trim().toLowerCase()
export function route(converters: readonly Converter[], from: string, to: string): Converter[] | null {
    from = normalize_mime(from); to = normalize_mime(to)
    const direct = converters.find(edge => edge.from === from && edge.to === to)
    if (direct) return [direct]
    if (from === to) return []
    const queue: { mime: string, path: Converter[] }[] = [{ mime: from, path: [] }], seen = new Set([from])
    for (let i = 0; i < queue.length; i++) {
        for (const edge of converters) {
            if (edge.from !== queue[i].mime || seen.has(edge.to)) continue
            const path = [...queue[i].path, edge]
            if (edge.to === to) return path
            seen.add(edge.to); queue.push({ mime: edge.to, path })
        }
    }
    return null
}
export async function execute(path: readonly Converter[], source: Blob, options: Options, signal: AbortSignal): Promise<Blob> {
    let output = source
    for (const edge of path) {
        signal.throwIfAborted()
        try {
            output = await edge.run(output, options, signal)
            signal.throwIfAborted()
            if (normalize_mime(output.type) !== edge.to) throw new Error(`Expected ${edge.to}, received ${output.type}`)
        } catch (error) {
            signal.throwIfAborted()
            throw new Error(`${edge.id} (${edge.from} → ${edge.to}): ${String(error)}`)
        }
    }
    return output
}
