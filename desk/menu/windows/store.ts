/* IndexedDB transactions enforce revisions and unique names across tabs. Reads follow same-tab writes. */
import { validate_desktop, desktop_name_key, type Saved_Desktop, type Desktop_Snapshot } from "./model.ts"
export class Desktop_Conflict extends Error {}
let pending: Promise<unknown> = Promise.resolve()
function ordered<T>(operation: () => Promise<T>): Promise<T> {
    const next = pending.catch(() => {}).then(operation); pending = next; return next
}
async function database(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open("jazu_desktops", 1)
        request.onupgradeneeded = () => { const store = request.result.createObjectStore("groups", { keyPath: "id" }); store.createIndex("key", "key", { unique: true }) }
        request.onerror = () => reject(request.error)
        request.onblocked = () => reject(new Error("Desktop storage is blocked"))
        request.onsuccess = () => resolve(request.result)
    })
}
async function transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore, result: (value: T) => void, fail: (error: Error) => void) => void): Promise<T> {
    const db = await database()
    try {
        return await new Promise<T>((resolve, reject) => {
            const tx = db.transaction("groups", mode); let value: T, error: Error | undefined
            tx.oncomplete = () => resolve(value)
            tx.onabort = tx.onerror = () => reject(error ?? tx.error ?? new Error("Desktop storage failed"))
            try { run(tx.objectStore("groups"), next => { value = next }, reason => { error = reason; tx.abort() }) }
            catch (reason) { error = reason as Error; tx.abort() }
        })
    } finally { db.close() }
}
export function list_desktops(): Promise<Saved_Desktop[]> {
    return ordered(() => transaction("readonly", (store, result, fail) => {
        const request = store.getAll()
        request.onsuccess = () => {
            try { request.result.forEach(validate_desktop); result(request.result.sort((a, b) => a.name.localeCompare(b.name))) }
            catch (error) { fail(error as Error) }
        }
    }))
}
export function read_desktop(id: string): Promise<Saved_Desktop> {
    return ordered(() => transaction("readonly", (store, result, fail) => {
        const request = store.get(id)
        request.onsuccess = () => { try { validate_desktop(request.result); result(request.result) } catch (error) { fail(error as Error) } }
    }))
}
export function write_desktop(id: string, name: string, snapshot: Desktop_Snapshot, revision: number): Promise<Saved_Desktop> {
    const record: Saved_Desktop = { ...snapshot, version: 1, id, name: name.trim(), key: desktop_name_key(name), revision: revision + 1, updated: Date.now() }
    validate_desktop(record)
    return ordered(() => transaction("readwrite", (store, result, fail) => {
        const request = store.get(id)
        request.onsuccess = () => {
            if ((request.result?.revision ?? 0) !== revision) return fail(new Desktop_Conflict("Desktop changed in another tab"))
            try { const put = store.put(record); put.onsuccess = () => result(record) }
            catch (error) { fail(error as Error) }
        }
    }))
}
export function delete_desktop(id: string, revision: number): Promise<void> {
    return ordered(() => transaction("readwrite", (store, result, fail) => {
        const request = store.get(id)
        request.onsuccess = () => {
            if (request.result?.revision !== revision) return fail(new Desktop_Conflict("Desktop changed in another tab"))
            const remove = store.delete(id); remove.onsuccess = () => result(undefined)
        }
    }))
}
