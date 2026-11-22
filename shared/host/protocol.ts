/*
 * The messages a page may send to the host, and validation of them.
 * Entities:
 *   Host_Request - the closed set of accepted requests
 *   parse_request - unknown JSON -> Host_Request, or a Protocol_Error naming what is wrong
 * Scope:
 *   Pure. The host trusts nothing that arrives: the extension filters too, but this is the last gate before a shell exists.
 *   Replies (host -> page) are plain objects built in host.ts; their shape is documented in extension/README.md.
 */
export type Host_Request =
    | { type: "open", id: number, cols: number, rows: number }
    | { type: "input", id: number, data: Buffer }
    | { type: "resize", id: number, cols: number, rows: number }
    | { type: "close", id: number }

export class Protocol_Error extends Error {}

export const max_dimension = 500
const base64_pattern = /^[A-Za-z0-9+/]*={0,2}$/

function whole(value: unknown, minimum: number, maximum: number, name: string): number {
    if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) throw new Protocol_Error(`${name} must be an integer from ${minimum} to ${maximum}`)
    return value
}

export function parse_request(value: unknown): Host_Request {
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Protocol_Error("a request must be an object")
    const raw = value as Record<string, unknown>
    const id = whole(raw.id, 1, 2 ** 31 - 1, "id")
    switch (raw.type) {
        case "open": return { type: "open", id, cols: whole(raw.cols, 1, max_dimension, "cols"), rows: whole(raw.rows, 1, max_dimension, "rows") }
        case "resize": return { type: "resize", id, cols: whole(raw.cols, 1, max_dimension, "cols"), rows: whole(raw.rows, 1, max_dimension, "rows") }
        case "close": return { type: "close", id }
        case "input": {
            if (typeof raw.data !== "string" || !base64_pattern.test(raw.data)) throw new Protocol_Error("data must be base64")
            return { type: "input", id, data: Buffer.from(raw.data, "base64") }
        }
        default: throw new Protocol_Error(`unknown request type ${JSON.stringify(raw.type)}`)
    }
}
