/* Edge adapters keep emit independent of transport. Every poll/message re-enters origin policy. */
import type { Api_Call, Api_Event, Api_Result } from "../../shared/api/types.ts"
type Exchange = (call: Api_Call) => Promise<Api_Result>
type Live_Socket = WebSocket & { accept(): void }
const delay = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds))
function batch(result: Api_Result): { events: Api_Event[], cursor: string, closed: boolean } {
    if (result.status !== 200) throw new Error("Stream authorization, history or origin is unavailable")
    const value = (result.body as any)?.data
    if (!value || !Array.isArray(value.events) || value.events.length > 16 || typeof value.cursor !== "string" || value.events.some((event: Api_Event) => !event || !/^[a-f0-9]{24}:\d{1,16}$/.test(event.id) || !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(event.event) || JSON.stringify(event.data)?.length > 16384)) throw new Error("Invalid stream response")
    return value
}
export function live_response(request: Request, call: Api_Call, stream: NonNullable<Api_Result["stream"]>, exchange: Exchange, authorize: () => Promise<boolean>, policy: Record<string, string> = {}, keep_alive: (task: Promise<unknown>) => void = () => {}): Response {
    let cursor = stream.cursor, stopped = false
    let abort_socket: (() => void) | undefined
    const command = (action: "read" | "send" | "close", data?: unknown) => exchange({ ...call, request_id: crypto.randomUUID(), stream: { id: stream.id, action, cursor, ...(data === undefined ? {} : { data }) } })
    const close = async () => { if (stopped) return; stopped = true; request.signal.removeEventListener("abort", abort); try { await command("close") } catch { /* Origin TTL releases disconnected capabilities. */ } }
    const release = () => { const task = close(); keep_alive(task); return task }
    const abort = () => { if (abort_socket) abort_socket(); else void release() }
    request.signal.addEventListener("abort", abort, { once: true })
    if (request.signal.aborted) void release()
    const next = async () => { if (!await authorize()) throw new Error("Stream session expired"); const value = batch(await command("read")); cursor = value.cursor; return value }
    const headers = { "cache-control": "no-store", "content-security-policy": "sandbox; default-src 'none'; frame-ancestors 'none'", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", ...(policy.deprecation ? { deprecation: policy.deprecation } : {}), ...(policy.sunset ? { sunset: policy.sunset } : {}) }
    if (stream.transport === "sse") {
        const encoder = new TextEncoder()
        const body = new ReadableStream<Uint8Array>({
            async pull(controller) {
                if (stopped) { controller.close(); return }
                try {
                    const value = await next()
                    if (stopped) { controller.close(); return }
                    if (value.events.length) controller.enqueue(encoder.encode(value.events.map(event => `id: ${event.id}\nevent: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`).join("")))
                    else { controller.enqueue(encoder.encode(": heartbeat\n\n")); await delay(1000) }
                    if (value.closed) { controller.close(); await release() }
                } catch { if (!stopped) { controller.enqueue(encoder.encode('event: jazu-error\ndata: {"code":"stream_unavailable","message":"Reconnect; authorization or replay history may have expired"}\n\n')); controller.close() }; await release() }
            },
            async cancel() { await release() }
        })
        return new Response(body, { headers: { ...headers, "content-type": "text/event-stream; charset=utf-8", "x-accel-buffering": "no" } })
    }
    const pair = new (globalThis as unknown as { WebSocketPair: new () => Record<string, Live_Socket> }).WebSocketPair(), client = pair[0], socket = pair[1]
    socket.accept()
    let pending = 0
    let sending = Promise.resolve()
    const finish = (code = 1000, reason = "Stream closed") => { void release(); try { socket.close(code, reason) } catch {} }
    abort_socket = () => finish(1001, "Request aborted")
    socket.addEventListener("close", () => finish()); socket.addEventListener("error", () => finish(1011, "Socket error"))
    if (stopped) finish(1001, "Request aborted")
    socket.addEventListener("message", event => {
        if (stopped) return
        if (typeof event.data !== "string" || new TextEncoder().encode(event.data).length > 16384) { finish(1009, "Use JSON messages up to 16 KiB"); return }
        if (pending >= 4) { finish(1013, "Too many pending messages"); return }
        let value: unknown
        try { value = JSON.parse(event.data) } catch { finish(1007, "Invalid JSON"); return }
        pending++
        sending = sending.then(async () => { try { if (!stopped && (!await authorize() || (await command("send", value)).status !== 200)) finish(1008, "Message denied") } catch { finish(1011, "Origin unavailable") } finally { pending-- } })
    })
    void (async () => {
        try {
            while (!stopped) {
                const value = await next()
                if (stopped) break
                for (const event of value.events) socket.send(JSON.stringify(event))
                if (value.closed) { finish(); break }
                // No per-subscriber queue; a consumer beyond retained history is disconnected.
                await delay(value.events.length === 16 ? 20 : 1000)
            }
        } catch { finish(1008, "Authorization, history or origin unavailable") }
    })()
    return new Response(null, { status: 101, headers: { ...headers, ...(call.actor.owner ? { "x-jazu-websocket-usage": "Custom WebSocket connections and origin polling count against your Cloudflare plan" } : {}) }, webSocket: client } as ResponseInit)
}
