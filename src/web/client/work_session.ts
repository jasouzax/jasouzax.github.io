/* Guest/browser keys, immutable Drive recovery and client-only encrypted server fallback. */
import { get_auth, type Auth_State } from "./sign.ts"
import { generate_owner_key, wrap_room_key, encode_key, decode_key } from "../../work_crypto.ts"
import { open_drive, clear_drive, type Client_Key, type Drive_Vault } from "./work_drive.ts"
export type Work_Room = { id: string, email: string, name?: string, picture?: string, guest_id: number | null, owner_wrap: Client_Key["owner_wrap"] | null, owner_key_id: string, revoked: number }
export type Work_Context = { auth: Auth_State, csrf: string, owner_email: string, owner_key: { key_id: string, public_jwk: JsonWebKey } | null, room: Work_Room | null, guest_room: Work_Room | null, key?: Client_Key, vault?: Drive_Vault, storage?: "browser" | "drive" | "fallback", warning?: string, error?: string }
const guest_storage = "jazu_work_guest_v2"
const conflict = "Your Google account already has a conversation key. Guest messages were not transferred. Your guest conversation remains separate."
let cached: { identity: string, pending: Promise<Work_Context> } | null = null
export async function work_api(path: string, csrf: string, body?: unknown, signal?: AbortSignal): Promise<any> {
    const response = await fetch(path, { method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store", signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(15000)]), headers: { "content-type": "application/json", "x-jazu-work": "1", "x-jazu-csrf": csrf }, body: body === undefined ? undefined : JSON.stringify(body) })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error?.message ?? "Messaging is unavailable")
    return data
}
function guest_key(): Client_Key | undefined {
    try {
        const value = JSON.parse(localStorage.getItem(guest_storage) ?? "null") as Client_Key | null
        if (value && /^[a-f0-9-]{36}$/i.test(value.room) && decode_key(value.key).length === 32 && value.owner_wrap && value.key_id) return value
    } catch {}
}
export function reset_work(): void { cached = null; clear_drive() }
if (typeof document !== "undefined") document.addEventListener("jazu:auth", reset_work)
export async function work_context(retry = false): Promise<Work_Context> {
    const auth = await get_auth(retry)
    const identity = `${auth.user?.role ?? "guest"}:${auth.user?.email ?? ""}`
    if (retry || cached?.identity !== identity) {
        if (cached?.identity !== identity) clear_drive()
        cached = { identity, pending: navigator.locks ? navigator.locks.request("jazu-work-session-v2", () => initialize(auth)) : initialize(auth) }
    }
    return cached.pending.catch(error => { cached = null; throw error })
}
async function initialize(auth: Auth_State): Promise<Work_Context> {
    const context: Work_Context = { auth, ...await work_api("/api/v1/work/session", auth.csrf, {}) }
    const local = guest_key()
    if (!auth.user) {
        if (context.guest_room) {
            if (local?.room === context.guest_room.id) context.key = local
            else context.error = "This browser's conversation key is missing. Existing messages cannot be recovered by the server."
        } else if (local && !context.room) {
            // Never reuse a conversation belonging to a previous, cleared guest cookie.
            localStorage.setItem(`jazu_work_archived_${local.room}`, JSON.stringify(local))
            localStorage.removeItem(guest_storage)
        }
        return context
    }
    const api = (path: string, body?: unknown) => work_api(path, auth.csrf, body)
    const fallback = async (candidate?: Client_Key): Promise<void> => {
        if (candidate) context.key = (await api("/api/v1/work/unstored-key", { action: "save", client: candidate })).client
        context.storage = "fallback"
    }
    try {
        const backup = auth.user.role === "client" ? await api("/api/v1/work/unstored-key", { action: "load" }) : null
        let vault: Drive_Vault
        try { vault = context.vault = await open_drive(auth.user.email, api) }
        catch (error) {
            if (auth.user.role === "owner") throw error
            if (backup.client) { context.key = backup.client; await fallback() }
            else {
                // An unavailable existing Drive vault cannot safely be replaced with a fresh key.
                if (context.room || backup.drive_stored || (await api("/api/v1/work/key-file")).file_id) throw new Error("Reconnect Google Drive to restore your existing conversation key. No keys were replaced.")
                await fallback(local && context.guest_room?.id === local.room ? local : undefined)
            }
            await connect_key(context)
            return context
        }
        context.storage = "drive"
        if (auth.user.role === "owner") {
            if (!vault.value) {
                if (context.owner_key) throw new Error("Your owner private key is missing from Google Drive. Existing keys were preserved; do not replace them.")
                await vault.create({ v: 2, owner: await generate_owner_key() })
            }
            if (!vault.value?.owner) throw new Error("This Google account does not contain the owner's private encryption key")
            const published = await api("/api/v1/work/owner-key", { public_jwk: vault.value.owner.public_jwk })
            context.owner_key = { key_id: published.key_id, public_jwk: vault.value.owner.public_jwk }
            return context
        }
        if (backup.client) {
            context.key = backup.client
            try {
                const saved = await vault.create({ v: 2, client: backup.client })
                if (!same_key(saved.client, backup.client)) throw new Error("Google Drive contains a different key. Both keys were preserved; messages were not transferred.")
                await api("/api/v1/work/unstored-key", { action: "drive" })
            } catch (error) {
                await fallback()
                context.warning = error instanceof Error ? error.message : "Drive verification is pending. Your recovery backup was retained."
            }
        } else {
            if (!vault.value && context.room) throw new Error("Your conversation exists but its key is missing from Google Drive. No key was overwritten.")
            if (!vault.value && local && context.guest_room?.id === local.room) {
                try { await vault.create({ v: 2, client: local }) }
                catch { await fallback(local) }
            }
            if (vault.value && !vault.value.client) throw new Error("This private key file belongs to the owner, not a client conversation")
            context.key ??= vault.value?.client
        }
        await connect_key(context)
    } catch (error) { context.error = error instanceof Error ? error.message : "Key storage is unavailable" }
    return context
}

function same_key(a: Client_Key | undefined, b: Client_Key): boolean {
    return Boolean(a && a.room === b.room && a.key === b.key && a.key_id === b.key_id)
}
async function connect_key(context: Work_Context): Promise<void> {
    if (!context.key) return
    if (context.room && context.room.id !== context.key.room) throw new Error("The stored key does not match this account's conversation. Messages and keys were preserved.")
    if (context.guest_room && context.guest_room.id !== context.key.room) context.warning = conflict
    if (context.guest_room?.id === context.key.room) {
        await work_api(`/api/v1/work/rooms/${context.key.room}/bind`, context.csrf, {})
        localStorage.removeItem(guest_storage)
    }
}

let preparation: Promise<unknown> = Promise.resolve()
export function prepare_conversation(context: Work_Context): Promise<Client_Key> {
    const run = () => prepare_locked(context)
    if (navigator.locks) return navigator.locks.request("jazu-work-room-v2", run)
    const next = preparation.then(run, run); preparation = next.catch(() => {})
    return next
}
async function prepare_locked(context: Work_Context): Promise<Client_Key> {
    if (context.error) throw new Error(context.error)
    if (!context.owner_key) throw new Error("The owner is setting up encrypted messaging. Please try again shortly.")
    if (context.auth.user?.role === "owner") throw new Error("Choose a client from the Clients panel")
    if (!context.auth.user && !context.key) {
        // Another window/tab may have created the same guest's room while this composer was open.
        const local = guest_key()
        const latest = await work_api("/api/v1/work/session", context.csrf, {})
        context.csrf = latest.csrf
        if (latest.guest_room && local?.room !== latest.guest_room.id) throw new Error("This browser's conversation key is missing. Existing messages were preserved.")
        if (local) context.key = local
    }
    let key = context.key
    if (!key) {
        const room = crypto.randomUUID()
        const raw = encode_key(crypto.getRandomValues(new Uint8Array(32)))
        key = { room, key: raw, key_id: context.owner_key.key_id, owner_wrap: await wrap_room_key(raw, context.owner_key.public_jwk, room) }
        if (context.auth.user) {
            if (context.storage === "fallback") key = (await work_api("/api/v1/work/unstored-key", context.csrf, { action: "save", client: key })).client as Client_Key
            else {
                if (!context.vault) throw new Error("Reconnect Google Drive to save your conversation key")
                try {
                    const stored = await context.vault.create({ v: 2, client: key })
                    if (!stored.client) throw new Error("Invalid client key storage")
                    key = stored.client
                } catch {
                    key = (await work_api("/api/v1/work/unstored-key", context.csrf, { action: "save", client: key })).client as Client_Key
                    context.storage = "fallback"
                }
            }
        } else localStorage.setItem(guest_storage, JSON.stringify(key))
        context.key = key
    }
    await work_api("/api/v1/work/rooms", context.csrf, { id: key.room, owner_wrap: key.owner_wrap, key_id: key.key_id })
    return key
}
