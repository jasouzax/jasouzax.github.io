import type { dir_handle, file_handle } from "./desk_fs.ts"
import { available_name } from "./desk_files_util.ts"

export type home_mount = { handle: dir_handle, connected: boolean, writable: boolean }
export type home_change = { names: Map<string, string> }
export const home_listeners = new Set<(change: home_change) => Promise<void>>()
let mounted: Promise<home_mount> | null = null
let connecting = false

async function record(handle?: dir_handle | null): Promise<dir_handle | null> {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("jazu_home", 1)
        request.onupgradeneeded = () => request.result.createObjectStore("connection")
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
    })
    try {
        return await new Promise((resolve, reject) => {
            const transaction = db.transaction("connection", handle !== undefined ? "readwrite" : "readonly")
            const store = transaction.objectStore("connection")
            const request = handle === null ? store.delete("home") : handle ? store.put(handle.native_handle ?? handle, "home") : store.get("home")
            transaction.oncomplete = () => resolve(handle ?? request.result ?? null)
            transaction.onerror = transaction.onabort = () => reject(transaction.error ?? new Error("Folder connection could not be saved"))
        })
    } finally { db.close() }
}

export function home_directory(): Promise<home_mount> {
    return mounted ??= (async () => {
        let handle: dir_handle | null = null
        try { handle = await record() } catch { /* private storage can still be used without IndexedDB */ }
        if (handle) {
            let writable = false
            try { writable = !handle.queryPermission || await handle.queryPermission({ mode: "readwrite" }) === "granted" } catch { /* show the saved connection as unavailable */ }
            // Never replace a disconnected folder with an old private-storage copy.
            return { handle, connected: true, writable }
        }
        return { handle: await navigator.storage.getDirectory(), connected: false, writable: true }
    })().catch(error => { mounted = null; throw error })
}

async function copy(source: file_handle | dir_handle, target: dir_handle, name: string): Promise<void> {
    if (source.kind === "file") {
        const file = await target.getFileHandle(name, { create: true })
        if (!file.createWritable) throw new Error("Folder is read-only")
        const writer = await file.createWritable()
        await writer.write(await source.getFile()); await writer.close()
    } else {
        const directory = await target.getDirectoryHandle(name, { create: true })
        for await (const entry of source.values()) await copy(entry, directory, entry.name)
    }
}

type native_directory = dir_handle & {
    isSameEntry?: (other: dir_handle) => Promise<boolean>
    resolve?: (other: dir_handle) => Promise<string[] | null>
}

export async function connect_home(target: dir_handle): Promise<{ persistent: boolean }> {
    if (connecting) throw new Error("A folder connection is already in progress")
    connecting = true
    try {
        if (target.queryPermission && await target.queryPermission({ mode: "readwrite" }) !== "granted") throw new Error("Read and write access is required")
        const previous = await home_directory()
        const source = previous.handle as native_directory
        const transferred: string[] = []
        const same = !!await source.isSameEntry?.(target)
        const names = new Map<string, string>()
        if (!same) {
            if (await source.resolve?.(target) || await (target as native_directory).resolve?.(source)) throw new Error("Choose a folder outside the current home folder")
            const occupied = new Set<string>(), entries: (file_handle | dir_handle)[] = []
            for await (const entry of target.values()) occupied.add(entry.name)
            for await (const entry of source.values()) entries.push(entry)
            // Existing names are preserved, including whole directory trees.
            for (const entry of entries) {
                const name = available_name(entry.name, occupied)
                occupied.add(name)
                await copy(entry, target, name)
                names.set(entry.name, name)
                if (!previous.connected) transferred.push(entry.name)
            }
        }
        let persistent = true
        try { await record(target) } catch { persistent = false }
        mounted = Promise.resolve({ handle: target, connected: true, writable: true })
        await Promise.all([...home_listeners].map(listener => listener({ names })))
        // Only clear private storage after every copy and the mount switch succeed.
        // Connecting another local folder must never delete the original folder.
        for (const name of transferred) await source.removeEntry(name, { recursive: true })
        document.dispatchEvent(new Event("jazu:home"))
        return { persistent }
    } finally { connecting = false }
}

export async function disconnect_home(): Promise<void> {
    if (connecting) throw new Error("A folder connection is already in progress")
    connecting = true
    try {
        const handle = await navigator.storage.getDirectory()
        await record(null)
        mounted = Promise.resolve({ handle, connected: false, writable: true })
        await Promise.all([...home_listeners].map(listener => listener({ names: new Map() })))
        document.dispatchEvent(new Event("jazu:home"))
    } finally { connecting = false }
}

// Call from a user gesture: browsers may require a fresh grant in a new tab.
export async function authorize_home(mount: home_mount): Promise<void> {
    const permission = mount.handle.requestPermission?.({ mode: "readwrite" })
    if (permission && await permission !== "granted") throw new Error("Read and write access is required")
    mount.writable = true
    await Promise.all([...home_listeners].map(listener => listener({ names: new Map() })))
    document.dispatchEvent(new Event("jazu:home"))
}

let refreshing: Promise<home_mount> | null = null
export function refresh_home_directory(): Promise<home_mount> {
    return refreshing ??= (async () => {
        const mount = await home_directory()
        if (!mount.connected || connecting || !mount.handle.queryPermission) return mount
        let permission = "denied"
        try { permission = await mount.handle.queryPermission({ mode: "readwrite" }) } catch { /* treat a lost handle as revoked */ }
        // A saved handle can need authorization in a new tab. Losing an existing
        // grant (including returning to prompt after revocation) disconnects it.
        if ((permission === "denied" || (mount.writable && permission !== "granted")) && !connecting) {
            await disconnect_home()
            return home_directory()
        }
        return mount
    })().finally(() => { refreshing = null })
}
