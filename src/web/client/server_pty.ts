/*
 * One real shell of the Pi over the owner's link: the page side of the agent's terminal channel (server/src/pty_channel.ts).
 *
 * Entities
 *   open_pty_session   sends pty_open, turns pty_out bytes (base64) into text, reports pty_exit / pty_err / a lost link through `exit`
 * Scope
 *   No DOM, no kernel: it only needs a link with send and on. The terminal program (server_terminal.ts) and the tests use it the same way.
 * Limits
 *   Output is decoded as streaming UTF-8 so a character split across two chunks stays whole; input is encoded the same way.
 */
import type { Client_Message } from "../../../shared/protocol/wire.ts"
import { from_base64, to_base64 } from "../../../shared/protocol/codec.ts"

export type Pty_Link = { send(message: Client_Message): boolean, on(type: string, handler: (message: { t: string, [key: string]: unknown }) => void): () => void }
export type Pty_Session = { write: (data: string) => void, resize: (cols: number, rows: number) => void, close: () => void }

let next_pty = 1

export function open_pty_session(link: Pty_Link, cols: number, rows: number, output: (chunk: string) => void, exit: (code: number, reason?: string) => void, cwd?: string): Pty_Session {
    const id = next_pty++
    const decoder = new TextDecoder()
    const encoder = new TextEncoder()
    let live = true
    const offs: (() => void)[] = []
    const finish = (code: number, reason?: string): void => {
        if (!live) return
        live = false
        for (const off of offs) off()
        exit(code, reason)
    }
    offs.push(link.on("pty_out", message => {
        if (message.id !== id) return
        try { output(decoder.decode(from_base64(String(message.data ?? "")), { stream: true })) } catch { /* a corrupt chunk is dropped */ }
    }))
    offs.push(link.on("pty_exit", message => { if (message.id === id) finish(Number(message.code ?? 0)) }))
    offs.push(link.on("pty_err", message => { if (message.id === id) finish(1, String(message.message ?? "terminal error")) }))
    offs.push(link.on("status", message => { if (message.online === false) finish(1, "The server is offline") }))
    offs.push(link.on("disconnected", () => finish(1, "The connection to the server was lost")))
    if (!link.send({ t: "pty_open", id, cols, rows, ...(cwd ? { cwd } : {}) })) { queueMicrotask(() => finish(1, "The server is offline")); }
    return {
        write: data => { if (live) link.send({ t: "pty_input", id, data: to_base64(encoder.encode(data)) }) },
        resize: (next_cols, next_rows) => { if (live) link.send({ t: "pty_resize", id, cols: next_cols, rows: next_rows }) },
        close: () => { if (!live) return; link.send({ t: "pty_close", id }); live = false; for (const off of offs) off() },
    }
}
