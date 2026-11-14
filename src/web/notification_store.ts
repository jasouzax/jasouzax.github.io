/* Shared by documents and the service worker. IndexedDB stores non-exportable device keys, never plaintext messages. */
export type Device_Key = { email: string, role: "owner" | "client", room?: string, key: CryptoKey }
const database_name = "jazu-notifications-v1"
async function database(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(database_name, 1)
        request.onupgradeneeded = () => { request.result.createObjectStore("settings"); request.result.createObjectStore("seen") }
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
    })
}
export async function device_key(value?: Device_Key | null): Promise<Device_Key | undefined> {
    const db = await database()
    try {
        return await new Promise((resolve, reject) => {
            const transaction = db.transaction("settings", value === undefined ? "readonly" : "readwrite"), store = transaction.objectStore("settings")
            const request = value === undefined ? store.get("key") : value === null ? store.delete("key") : store.put(value, "key")
            transaction.oncomplete = () => resolve(value === undefined ? request.result : value ?? undefined)
            transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error)
        })
    } finally { db.close() }
}
export async function first_notification(id: string): Promise<boolean> {
    const db = await database()
    try {
        return await new Promise((resolve, reject) => {
            const transaction = db.transaction("seen", "readwrite"), store = transaction.objectStore("seen"), request = store.get(id)
            let first = false
            request.onsuccess = () => {
                first = request.result === undefined
                if (first) store.put(Date.now(), id)
                const cursor = store.openCursor()
                cursor.onsuccess = () => { const entry = cursor.result; if (entry) { if (entry.value < Date.now() - 7 * 86400000) entry.delete(); entry.continue() } }
            }
            transaction.oncomplete = () => resolve(first); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error)
        })
    } finally { db.close() }
}
