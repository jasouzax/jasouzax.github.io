/** Account homes point at a chosen Drive folder, or alias the anonymous browser home. */
import { get_auth } from "../work/sign.ts"
import { drive_directory } from "./drive.ts"
import { home_directory } from "./home.ts"
import type { dir_handle, file_handle } from "./opfs.ts"

export type Account_Identity = { name: string, home: string, email: string }
let identity: Account_Identity = { name: "user", home: "/home/user", email: "" }
let generation = 0
let request_revision = 0
let mounted_key = ""
let mounted_handle: dir_handle | null = null
let drive: { email: string, folder: string, handle: dir_handle } | null = null
const key = (email: string) => `jazu:account-home:${email.toLowerCase()}`

export async function account_username(email: string): Promise<string> {
    const canonical = email.trim().toLowerCase()
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical)))
    const suffix = [...digest.subarray(0, 5)].map(byte => byte.toString(16).padStart(2, "0")).join("")
    const local = canonical.split("@")[0].replace(/[^a-z0-9_-]/g, "_").slice(0, 32) || "account"
    return `${local}_${suffix}`
}

export function account_identity(): Account_Identity { return { ...identity } }
export function account_folder(email: string): string | null {
    try { const folder = localStorage.getItem(key(email)); return folder && /^[a-zA-Z0-9_-]+$/.test(folder) ? folder : null } catch { return null }
}

/** Guard every retained child/writer as well as directory lookup; browser root cannot bypass this. */
export function account_directory(handle: dir_handle, allowed: () => Promise<boolean>): dir_handle {
    const check = async () => { if (!await allowed()) throw new DOMException("Sign in to access this account's home", "NotAllowedError") }
    const file = (entry: file_handle): file_handle => ({ kind: "file", name: entry.name,
        async getFile() { await check(); const value = await entry.getFile(); await check(); return value },
        ...(entry.move ? { async move(name: string) { await check(); await entry.move!(name) } } : {}),
        ...(entry.createWritable ? { async createWritable() {
            await check(); const writer = await entry.createWritable!()
            return { async write(data: Blob | string) { await check(); await writer.write(data) }, async close() { await check(); await writer.close() } }
        } } : {}),
    })
    return { kind: "directory", name: handle.name,
        async queryPermission(options) { return await allowed() ? handle.queryPermission ? handle.queryPermission(options) : "granted" : "denied" },
        async *values() { await check(); for await (const entry of handle.values()) { await check(); yield entry.kind === "directory" ? account_directory(entry, allowed) : file(entry) } },
        async getFileHandle(name, options) { await check(); return file(await handle.getFileHandle(name, options)) },
        async getDirectoryHandle(name, options) { await check(); return account_directory(await handle.getDirectoryHandle(name, options), allowed) },
        async removeEntry(name, options) { await check(); await handle.removeEntry(name, options) },
    }
}

export async function resolve_account_home(): Promise<{ identity: Account_Identity, handle: dir_handle, writable: boolean } | null | undefined> {
    const revision = ++request_revision
    const auth = await get_auth().catch(() => null)
    const email = auth?.user?.email.toLowerCase() || ""
    const name = email ? await account_username(email) : "user"
    if (revision !== request_revision) return undefined
    if (!email) {
        if (mounted_key || mounted_handle) generation++
        mounted_key = ""; mounted_handle = null; drive = null
        identity = { email, name, home: `/home/${name}` }
        return null
    }
    const folder = account_folder(email)
    const anonymous = await home_directory()
    let handle = anonymous.handle, writable = anonymous.writable
    let next_drive = drive
    if (folder) {
        if (next_drive?.email !== email || next_drive.folder !== folder) {
            // A saved Drive choice is never silently redirected to browser storage on failure.
            try { next_drive = { email, folder, handle: await drive_directory(folder) } }
            catch { next_drive = null; writable = false; handle = unavailable_home(name) }
        }
        if (next_drive?.email === email && next_drive.folder === folder) handle = next_drive.handle
    } else next_drive = null
    if (revision !== request_revision) return undefined
    drive = next_drive
    const next_key = `${email}\n${folder || ""}`
    if (mounted_key !== next_key || mounted_handle !== handle) generation++
    mounted_key = next_key; mounted_handle = handle
    identity = { email, name, home: `/home/${name}` }
    const mounted_generation = generation
    const allowed = async () => mounted_generation === generation && (await get_auth()).user?.email.toLowerCase() === email
    return { identity: { ...identity }, handle: account_directory(handle, allowed), writable }
}

function unavailable_home(name: string): dir_handle {
    const denied = async (): Promise<never> => { throw new DOMException("Reconnect Google Drive to access this home", "NotAllowedError") }
    return { kind: "directory", name, async *values() { await denied() }, getFileHandle: denied, getDirectoryHandle: denied, removeEntry: denied }
}

export async function set_account_home(folder: string | null): Promise<void> {
    const email = (await get_auth()).user?.email.toLowerCase()
    if (!email) throw new Error("Sign in before choosing a personal home")
    if (folder !== null && !/^[a-zA-Z0-9_-]+$/.test(folder)) throw new Error("Invalid Drive folder")
    // Validate access before saving the choice; existing local and Drive files are never moved.
    const handle = folder ? await drive_directory(folder) : null
    if ((await get_auth()).user?.email.toLowerCase() !== email) throw new Error("The signed-in account changed")
    if (folder) localStorage.setItem(key(email), folder)
    else localStorage.removeItem(key(email))
    drive = folder && handle ? { email, folder, handle } : null
    document.dispatchEvent(new Event("jazu:account-home"))
}

export function invalidate_account_home(revoke = true): void { request_revision++; if (revoke) generation++ }
