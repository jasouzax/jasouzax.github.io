/* Site-wide, channel-neutral live transport. Guests acquire it only while a Work view is mounted. */
import { get_auth } from "./sign.ts"
let account = ""
let socket: WebSocket | null = null, identity = "", guest_views = 0, generation = 0, attempt = 0, connected = false, replaced = false
let reconnect: ReturnType<typeof setTimeout> | undefined, heartbeat: ReturnType<typeof setInterval> | undefined, pong_at = 0
const requests = new Map<string, { resolve(value: any): void, reject(error: Error): void, timer: ReturnType<typeof setTimeout> }>()
const watches = new Map<string, Set<AbortSignal>>()
const seen_notifications = new Set<string>()
export const realtime_connected = () => connected
export const realtime_replaced = () => replaced
function state(value: boolean): void { connected = value; document.dispatchEvent(new CustomEvent("jazu:realtime-state", { detail: { connected: value, replaced } })) }
function stop(): void {
    generation++; clearTimeout(reconnect); clearInterval(heartbeat)
    const old = socket; socket = null; old?.close(1000, "Connection changed")
    for (const request of requests.values()) { clearTimeout(request.timer); request.reject(new Error("Connection lost before confirmation; retry safely")) }
    requests.clear(); state(false)
}
async function refresh(): Promise<void> {
    const auth = await get_auth(), next = auth.user ? `account:${auth.user.email}` : guest_views ? "guest" : ""
    account = auth.user?.email ?? ""
    if (identity !== next) { stop(); identity = next; attempt = 0; replaced = false }
    if (identity && !socket && !replaced) connect()
}
function connect(): void {
    if (!identity || socket || replaced) return
    const revision = generation, url = new URL("/api/v1/realtime", location.href); url.protocol = location.protocol === "https:" ? "wss:" : "ws:"
    const ws = socket = new WebSocket(url)
    ws.addEventListener("message", event => {
        if (socket !== ws || revision !== generation) return
        if (event.data === "pong") { pong_at = Date.now(); return }
        let data: any; try { data = JSON.parse(event.data) } catch { return }
        if (data.type === "ready") {
            attempt = 0; pong_at = Date.now(); clearInterval(heartbeat)
            heartbeat = setInterval(() => { if (Date.now() - pong_at >= 90000) ws.close(4000, "Heartbeat expired"); else if (ws.readyState === WebSocket.OPEN) ws.send("ping") }, 30000)
            state(true); return
        }
        if (data.type === "ack") {
            const pending = requests.get(data.request_id)
            if (pending) { requests.delete(data.request_id); clearTimeout(pending.timer); data.error ? pending.reject(new Error(data.error)) : pending.resolve(data.result) }
            return
        }
        document.dispatchEvent(new CustomEvent("jazu:realtime", { detail: data }))
        if (data.type === "notification" && !data.self) notify(data)
    })
    ws.addEventListener("close", event => {
        if (socket !== ws || revision !== generation) return
        socket = null; clearInterval(heartbeat); replaced = event.code === 4001; state(false)
        for (const pending of requests.values()) { clearTimeout(pending.timer); pending.reject(new Error("Connection lost before confirmation; retry safely")) }; requests.clear()
        if (event.code === 4003) { identity = ""; void get_auth(true).then(() => document.dispatchEvent(new Event("jazu:auth"))).catch(() => {}); return }
        if (!replaced && identity) reconnect = setTimeout(connect, Math.min(30000, 1000 * 2 ** Math.min(attempt++, 5)) + Math.random() * 500)
    })
    ws.addEventListener("error", () => ws.close())
}
export function realtime_ready(signal?: AbortSignal): Promise<void> {
    if (connected) return Promise.resolve()
    return new Promise((resolve, reject) => {
        const done = (error?: Error) => { clearTimeout(timer); document.removeEventListener("jazu:realtime-state", changed); signal?.removeEventListener("abort", aborted); error ? reject(error) : resolve() }
        const changed = () => { if (connected) done() }, aborted = () => done(new Error("Conversation closed"))
        const timer = setTimeout(() => done(new Error(replaced ? "This guest session is connected in another tab" : "Live connection is unavailable; try again shortly")), 15000)
        document.addEventListener("jazu:realtime-state", changed); signal?.addEventListener("abort", aborted, { once: true })
        if (signal?.aborted) aborted()
    })
}
export async function realtime_request(body: object, signal?: AbortSignal): Promise<any> {
    await realtime_ready(signal)
    if (signal?.aborted) throw new Error("Conversation closed")
    const request_id = crypto.randomUUID()
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { requests.delete(request_id); reject(new Error("Message not confirmed; retry safely")) }, 15000)
        requests.set(request_id, { resolve, reject, timer })
        try { socket!.send(JSON.stringify({ ...body, request_id })) } catch { clearTimeout(timer); requests.delete(request_id); reject(new Error("Live connection is unavailable")) }
    })
}
export async function watch_conversation(channel: string, conversation: string, after: number, signal: AbortSignal): Promise<any> {
    const key = `${channel}:${conversation}`, refs = watches.get(key) ?? new Set<AbortSignal>()
    if (!refs.has(signal)) {
        refs.add(signal); watches.set(key, refs)
        signal.addEventListener("abort", () => { refs.delete(signal); if (!refs.size) { watches.delete(key); if (connected) void realtime_request({ type: "unwatch", channel, conversation }).catch(() => {}) } }, { once: true })
    }
    return realtime_request({ type: "watch", channel, conversation, after }, signal)
}
export function acquire_guest(signal: AbortSignal): void {
    guest_views++; void refresh().catch(() => {})
    signal.addEventListener("abort", () => { guest_views--; void refresh().catch(() => {}) }, { once: true })
}
function notify(data: any): void {
    const notification_id = `${data.channel}:${data.conversation}:${data.id}`
    if (typeof data.id !== "string" || seen_notifications.has(notification_id)) return
    seen_notifications.add(notification_id); if (seen_notifications.size > 1000) seen_notifications.delete(seen_notifications.values().next().value!)
    if (!document.dispatchEvent(new CustomEvent("jazu:incoming-message", { detail: data, cancelable: true }))) return
    const labels = document.querySelector<HTMLElement>("[data-notifications]")?.dataset
    const title = labels?.notificationTitle ?? "New message"
    const target = new URL(typeof data.href === "string" ? data.href : "/", location.origin)
    const href = target.origin === location.origin && /^https?:$/.test(target.protocol) ? target.pathname + target.search + target.hash : "/"
    let container = document.getElementById("realtime_notifications")
    if (!container) { container = document.createElement("aside"); container.id = "realtime_notifications"; container.className = "realtime_notifications"; container.setAttribute("aria-live", "polite"); document.body.append(container) }
    const card = document.createElement("div"); card.className = "realtime_notification"
    const link = document.createElement("a"); link.href = href; link.textContent = `${title}: ${String(data.sender ?? "").slice(0, 200)}`
    const dismiss = document.createElement("button"); dismiss.type = "button"; dismiss.textContent = "×"; dismiss.setAttribute("aria-label", labels?.notificationDismiss ?? "Dismiss notification"); dismiss.addEventListener("click", () => card.remove())
    card.dataset.conversation = data.conversation; card.dataset.channel = data.channel
    card.append(link, dismiss); container.append(card); while (container.children.length > 5) container.firstElementChild?.remove()
    setTimeout(() => card.remove(), 20000)
    if (document.hidden && "Notification" in window && Notification.permission === "granted") {
        const notification = new Notification(title, { body: String(data.sender ?? ""), tag: notification_id })
        notification.onclick = () => { window.focus(); location.assign(href); notification.close() }
    }
}
export function init_realtime(): void {
    const auth_channel = "BroadcastChannel" in window ? new BroadcastChannel("jazu-auth-changed") : null
    document.addEventListener("jazu:auth", () => { void refresh().then(() => auth_channel?.postMessage(account)).catch(() => {}) })
    if (auth_channel) auth_channel.onmessage = event => { if (typeof event.data === "string" && event.data !== account) void get_auth(true).then(() => document.dispatchEvent(new Event("jazu:auth"))).catch(() => {}) }
    window.addEventListener("online", () => { attempt = 0; if (!socket) void refresh().catch(() => {}) })
    const resume = () => {
        if (!document.hidden && identity) {
            if (replaced) { replaced = false; attempt = 0; document.dispatchEvent(new Event("jazu:guest-resume")); return }
            if (socket && Date.now() - pong_at >= 90000) { stop(); attempt = 0 }
            if (!socket) connect()
        }
    }
    document.addEventListener("visibilitychange", resume)
    window.addEventListener("focus", resume)
    document.addEventListener("jazu:conversation-open", event => {
        const data = (event as CustomEvent).detail
        for (const card of document.querySelectorAll<HTMLElement>(".realtime_notification")) if (card.dataset.channel === data.channel && card.dataset.conversation === data.conversation) card.remove()
    })
    window.addEventListener("pagehide", () => stop())
    window.addEventListener("pageshow", () => { void refresh().catch(() => {}) })
    const paint_notifications = () => {
        const button = document.querySelector<HTMLButtonElement>("[data-notifications]")
        if (!button) return
        if (!("Notification" in window)) { button.hidden = true; return }
        if (Notification.permission === "granted") button.textContent = button.dataset.notificationEnabled ?? "Notifications enabled"
        else if (Notification.permission === "denied") button.textContent = button.dataset.notificationDenied ?? "Notifications blocked"
    }
    document.addEventListener("jazu:page", paint_notifications)
    document.addEventListener("jazu:auth", paint_notifications)
    paint_notifications()
    document.addEventListener("click", event => {
        const button = (event.target as Element).closest<HTMLButtonElement>("[data-notifications]")
        if (!button || !("Notification" in window)) return
        event.preventDefault(); void Notification.requestPermission().then(permission => { button.textContent = permission === "granted" ? button.dataset.notificationEnabled ?? "Notifications enabled" : button.dataset.notificationDenied ?? "Notifications blocked" })
    })
    void refresh().catch(() => {})
}
