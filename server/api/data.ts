/* Canonical JSON fingerprints bind durable jobs and request keys to their actual JSON payload. */
import { createHash } from "node:crypto"
import { api_limit } from "../../shared/api/types.ts"
export function data_json(value: unknown): string {
    const sort = (value: any): any => Array.isArray(value) ? value.map(sort) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])])) : value
    const text = JSON.stringify(sort(JSON.parse(JSON.stringify(value ?? null))))
    if (Buffer.byteLength(text) > api_limit) throw new Error("JSON data exceeds the API transport limit")
    return text
}
export const data_hash = (value: unknown): string => createHash("sha256").update(data_json(value)).digest("hex")
