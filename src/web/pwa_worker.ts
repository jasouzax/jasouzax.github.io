/* Public build snapshots are atomic. API, cookies, messages and private keys never enter CacheStorage. */
import { device_key, first_notification } from "./notification_store.ts"
import { preview_message, type Message_Notice } from "./notification_preview.ts"
declare const __PWA__: { version: string, entries: { url: string, revision: string }[], notifications: boolean }
type Lifetime = { waitUntil(task: Promise<unknown>): void }
type Fetch_Event = Lifetime & { request: Request, respondWith(response: Promise<Response>): void }
const worker = globalThis as unknown as {
    location: Location, skipWaiting(): Promise<void>, clients: { claim(): Promise<void>, matchAll(options?: object): Promise<any[]>, openWindow(url: string): Promise<unknown> },
    registration: ServiceWorkerRegistration, addEventListener(type: string, listener: (event: any) => void): void
}
const cache_name = `jazu-public-${__PWA__.version}`
const allowed = new Set(__PWA__.entries.map(entry => entry.url))
worker.addEventListener("install", (event: Lifetime) => event.waitUntil((async () => {
    const cache = await caches.open(cache_name)
    try {
        // Bounded parallelism avoids exhausting mobile connections or memory with hundreds of fonts.
        let index = 0
        await Promise.all(Array.from({ length: 4 }, async () => {
            while (index < __PWA__.entries.length) {
                const entry = __PWA__.entries[index++]
                // Pages serves "/x/index.html" from "/x/" (308), so request the canonical URL and cache it under the allowlisted name.
                const source = entry.url.endsWith("/index.html") ? entry.url.slice(0, -"index.html".length) : entry.url
                const response = await fetch(source, { credentials: "omit", cache: "reload", redirect: "follow" })
                // Same-origin redirects are tolerated because the revision hash below proves the bytes; anything else is rejected.
                if (!response.ok || response.type === "opaque" || response.headers.has("set-cookie") || new URL(response.url).origin !== worker.location.origin) throw new Error(`Offline download failed: ${entry.url}`)
                // Never combine a cached old page with assets from a newer deployment.
                const bytes = await response.arrayBuffer()
                const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(byte => byte.toString(16).padStart(2, "0")).join("")
                if (hash !== entry.revision) throw new Error(`Offline revision changed: ${entry.url}`)
                await cache.put(entry.url, new Response(bytes, { status: response.status, headers: response.headers }))
            }
        }))
    } catch (error) { await caches.delete(cache_name); throw error }
    // Updates wait until old documents close, preserving each build's coherent asset graph.
})()))
worker.addEventListener("activate", (event: Lifetime) => event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name.startsWith("jazu-public-") && name !== cache_name) await caches.delete(name)
    await worker.clients.claim()
    for (const client of await worker.clients.matchAll()) client.postMessage({ type: "jazu:offline-ready", version: __PWA__.version })
})()))
worker.addEventListener("fetch", (event: Fetch_Event) => {
    const url = new URL(event.request.url)
    if (event.request.method !== "GET" || url.origin !== worker.location.origin || url.pathname.startsWith("/api/") || event.request.headers.has("range")) return
    let path = url.pathname
    if (!allowed.has(path)) path = path.endsWith("/") ? `${path}index.html` : `${path}/index.html`
    if (!allowed.has(path)) return
    event.respondWith((async () => {
        // Network-first documents allow fresh releases online; cached snapshots remain complete offline.
        if (event.request.mode === "navigate") try { return await fetch(event.request) } catch {}
        return (await (await caches.open(cache_name)).match(path)) ?? fetch(event.request)
    })())
})
async function show_message(data: Message_Notice): Promise<void> {
    if (!__PWA__.notifications || !data || data.channel !== "work") return
    const key = await device_key()
    if (!key) return
    let text: string
    try { text = await preview_message(data, key) }
    catch {
        // Recheck auth before showing even a generic preview or using a stale device key.
        try {
            const response = await fetch("/api/v1/auth/session", { credentials: "same-origin", cache: "no-store" })
            if (!response.ok) return
            const auth = await response.json()
            if (auth.user?.email !== key.email) { await device_key(null); return }
        } catch { return }
        text = "Open the app to read this message."
    }
    const clients = await worker.clients.matchAll({ type: "window", includeUncontrolled: true })
    // A visible document owns in-page delivery; hidden/closed applications receive the native alert.
    if (clients.some(client => client.visibilityState === "visible")) {
        for (const client of clients) if (client.visibilityState === "visible") client.postMessage({ type: "jazu:push", notice: data })
        return
    }
    if (!await first_notification(`${key.email}:${data.channel}:${data.conversation}:${data.id}`)) return
    const target = new URL(data.href, worker.location.origin)
    const href = target.origin === worker.location.origin && target.pathname.startsWith("/work/") ? target.pathname + target.search : "/work/"
    await worker.registration.showNotification(String(data.sender).slice(0, 254), { body: text, tag: `${data.channel}:${data.conversation}:${data.id}`, icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", data: { href } })
}
worker.addEventListener("push", (event: Lifetime & { data?: { json(): any } }) => {
    try { const data = event.data?.json(); event.waitUntil(show_message(data)) } catch {}
})
worker.addEventListener("message", (event: Lifetime & { data: any, source?: { url?: string } }) => {
    if (!event.source?.url || new URL(event.source.url).origin !== worker.location.origin) return
    if (event.data?.type === "jazu:notify") event.waitUntil(show_message(event.data.notice))
    if (event.data?.type === "jazu:clear-notifications") event.waitUntil((async () => {
        for (const notification of await worker.registration.getNotifications()) notification.close()
    })())
})
worker.addEventListener("notificationclick", (event: Lifetime & { notification: Notification }) => {
    event.notification.close()
    event.waitUntil((async () => {
        const target = new URL(event.notification.data?.href ?? "/work/", worker.location.origin)
        if (target.origin !== worker.location.origin) return
        const clients = await worker.clients.matchAll({ type: "window", includeUncontrolled: true })
        for (const client of clients) if (new URL(client.url).origin === target.origin) { await client.navigate(target.href); await client.focus(); return }
        await worker.clients.openWindow(target.href)
    })())
})
