import { get_auth } from "./sign.ts"
import { work_context, work_api } from "./work_session.ts"
import { decode_key, decrypt_message } from "../../work_crypto.ts"
import { device_key, type Device_Key } from "../notification_store.ts"
import { preview_message, type Message_Notice } from "../notification_preview.ts"
import { pwa_registration } from "./pwa.ts"
let epoch = 0, email = "", memory: Device_Key | undefined, preparation: Promise<Device_Key | undefined> | undefined
export async function prepare_notifications(): Promise<Device_Key | undefined> {
    const revision = epoch, auth = await get_auth()
    if (revision !== epoch) return
    if (!auth.user) {
        email = ""; memory = undefined; await device_key(null)
        navigator.serviceWorker?.controller?.postMessage({ type: "jazu:clear-notifications" })
        return
    }
    if (email !== auth.user.email) {
        email = auth.user.email; memory = undefined; preparation = undefined
        const previous = await device_key()
        if (revision !== epoch) return
        if (previous?.email === email && previous.role === auth.user.role) memory = previous
        else await device_key(null)
    }
    if (revision !== epoch) return
    return preparation ??= (async () => {
        const context = await work_context()
        if (revision !== epoch || context.auth.user?.email !== email) return
        let key: Device_Key | undefined
        if (context.auth.user.role === "owner" && context.vault?.value?.owner) key = { email, role: "owner", key: await crypto.subtle.importKey("jwk", context.vault.value.owner.private_jwk, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveKey"]) }
        else if (context.key) key = { email, role: "client", room: context.key.room, key: await crypto.subtle.importKey("raw", decode_key(context.key.key), "AES-GCM", false, ["decrypt"]) }
        if (revision !== epoch) return
        if (key) { memory = key; await device_key(key) }
        else { const previous = await device_key(); if (previous?.email === email) memory = previous }
        if (revision !== epoch) { memory = undefined; return }
        return memory
    })().catch(() => { preparation = undefined; return undefined })
}
export async function notification_preview(data: Message_Notice & { seq?: number }): Promise<string> {
    const auth = await get_auth()
    if (auth.user) {
        const key = memory ?? await prepare_notifications()
        if (!key || key.email !== auth.user.email) throw new Error("Notification key unavailable")
        return preview_message(data, key)
    }
    const context = await work_context()
    if (context.auth.user || !context.key || context.key.room !== data.conversation) throw new Error("Notification key unavailable")
    const result = await work_api(`/api/v1/work/rooms/${context.key.room}/messages?after=${Math.max(0, (data.seq ?? 1) - 1)}`, context.csrf)
    const message = result.messages.find((row: any) => row.id === data.id)
    if (!message) throw new Error("Notification unavailable")
    return decrypt_message(context.key.key, message.envelope, { room: data.conversation, id: data.id, author: message.author })
}
export async function enable_push(): Promise<boolean> {
    const auth = await get_auth(), registration = await pwa_registration()
    if (!auth.user || !registration || !("PushManager" in window)) return false
    const ready = await navigator.serviceWorker.ready
    const response = await fetch("/api/v1/push/config", { credentials: "same-origin", cache: "no-store" })
    if (!response.ok) return false
    const config = await response.json()
    if (!config.enabled) return false
    await prepare_notifications()
    let subscription = await ready.pushManager.getSubscription()
    if (subscription?.options.applicationServerKey && encode_buffer(subscription.options.applicationServerKey) !== config.public_key) { await subscription.unsubscribe(); subscription = null }
    subscription ??= await ready.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decode_key(config.public_key) })
    if ((await get_auth()).user?.email !== auth.user.email) { await subscription.unsubscribe(); return false }
    await work_api("/api/v1/push/subscription", auth.csrf, { subscription: subscription.toJSON() })
    return true
}
function encode_buffer(value: ArrayBuffer): string { return btoa(String.fromCharCode(...new Uint8Array(value))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") }
export async function native_notice(data: Message_Notice, text: string): Promise<void> {
    if (Notification.permission !== "granted") return
    const registration = await pwa_registration()
    if (registration?.active) { registration.active.postMessage({ type: "jazu:notify", notice: data }); return }
    try {
        const notice = new Notification(data.sender, { body: text, tag: `${data.channel}:${data.conversation}:${data.id}` })
        notice.onclick = () => { window.focus(); location.assign(data.href); notice.close() }
    } catch { /* Mobile platforms require service-worker notifications. */ }
}
export function init_notification_keys(): void {
    const reset = () => {
        epoch++; email = ""; memory = undefined; preparation = undefined
        void prepare_notifications().then(async key => { if (key && "Notification" in window && Notification.permission === "granted") await enable_push() }).catch(() => {})
    }
    document.addEventListener("jazu:auth", reset)
    document.addEventListener("jazu:signed-out", () => {
        epoch++; email = ""; memory = undefined; preparation = undefined
        void device_key(null).catch(() => {})
        navigator.serviceWorker?.controller?.postMessage({ type: "jazu:clear-notifications" })
    })
    document.addEventListener("jazu:work-key", () => { preparation = undefined; void prepare_notifications() })
    window.addEventListener("online", () => { void prepare_notifications() })
    if (document.readyState === "complete") void prepare_notifications()
    else window.addEventListener("load", () => { void prepare_notifications() }, { once: true })
}
