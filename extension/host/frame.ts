/*
 * Native messaging framing (Chrome <-> host over stdio).
 * Entities:
 *   encode_frame - one JSON message -> 4-byte length (native byte order) + UTF-8 body
 *   Frame_Reader - turns a stream of stdin chunks into whole JSON messages
 * Scope:
 *   Knows nothing about what messages mean. Refuses oversized frames instead of buffering them (a hostile length must not exhaust memory).
 */
import { endianness } from "node:os"

// Chrome rejects host -> browser messages above 1 MiB
export const max_to_chrome = 1024 * 1024
// Chrome allows 64 MiB the other way; a terminal never needs more than a large paste
export const max_from_chrome = 4 * 1024 * 1024

const little = endianness() === "LE"

export function encode_frame(message: unknown): Buffer {
    const body = Buffer.from(JSON.stringify(message), "utf8")
    if (body.length > max_to_chrome) throw new Error(`message of ${body.length} bytes exceeds the 1 MiB native messaging limit`)
    const head = Buffer.alloc(4)
    if (little) head.writeUInt32LE(body.length)
    else head.writeUInt32BE(body.length)
    return Buffer.concat([head, body])
}

export class Frame_Reader {
    private pending: Buffer = Buffer.alloc(0)

    push(chunk: Buffer): unknown[] {
        this.pending = this.pending.length === 0 ? chunk : Buffer.concat([this.pending, chunk])
        const messages: unknown[] = []
        while (this.pending.length >= 4) {
            const length = little ? this.pending.readUInt32LE(0) : this.pending.readUInt32BE(0)
            if (length > max_from_chrome) throw new Error(`frame of ${length} bytes exceeds the limit`)
            if (this.pending.length < 4 + length) break
            messages.push(JSON.parse(this.pending.subarray(4, 4 + length).toString("utf8")))
            this.pending = this.pending.subarray(4 + length)
        }
        return messages
    }
}
