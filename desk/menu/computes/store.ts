import { computes_storage_name } from "../../fs/storage.ts"
/** Durable compute catalog. Provider tokens are never stored here. */
import { memory_directory, named_directory, type memory_handle } from "../../fs/memory.ts"
import type { dir_handle, file_handle } from "../../fs/opfs.ts"
export type Saved_Compute = { id: string, name: string, kind: "wasm" | "folder" | "drive", handle?: dir_handle, folder?: string, email?: string, order: number }
async function database(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open("jazu_computes", 1)
        request.onupgradeneeded = () => request.result.createObjectStore("computes", { keyPath: "id" })
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
        request.onblocked = () => reject(new Error("Compute storage is blocked"))
    })
}
async function transact<T>(mode: IDBTransactionMode, use: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await database()
    try {
        return await new Promise<T>((resolve, reject) => {
            const tx = db.transaction("computes", mode), request = use(tx.objectStore("computes"))
            tx.oncomplete = () => resolve(request.result)
            tx.onerror = tx.onabort = () => reject(tx.error || request.error || new Error("Compute storage failed"))
        })
    } finally { db.close() }
}
export async function saved_computes(): Promise<Saved_Compute[]> {
    const records = await transact<Saved_Compute[]>("readonly", store => store.getAll())
    return records.filter(record => /^[a-f0-9-]{36}$/.test(record.id) && typeof record.name === "string" && ["wasm", "folder", "drive"].includes(record.kind)).sort((a, b) => a.order - b.order)
}
export function save_compute(record: Saved_Compute): Promise<unknown> { return transact("readwrite", store => store.put(record)) }
export function forget_compute(id: string): Promise<unknown> { return transact("readwrite", store => store.delete(id)) }
async function computer_storage(): Promise<dir_handle> {
    return (await navigator.storage.getDirectory()).getDirectoryHandle(computes_storage_name, { create: true })
}
/** A persistent root with page-local /tmp and a replaceable /net overlay. */
export async function computer_directory(id: string, name: string, create = false): Promise<memory_handle> {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid computer ID")
    const base = await (await computer_storage()).getDirectoryHandle(id, { create })
    if (create) {
        for (const dir of ["bin", "etc", "home", "usr", "var", "srv", "dev", "proc", "lib", "root"]) await base.getDirectoryHandle(dir, { create: true })
        await (await base.getDirectoryHandle("home")).getDirectoryHandle("user", { create: true })
    }
    const mounts = new Map<string, dir_handle | file_handle>([["tmp", memory_directory("tmp")], ["net", memory_directory("net")]])
    return { kind: "directory", name, native_handle: base,
        mount(name, handle) { mounts.set(name, handle.kind === "directory" ? named_directory(name, handle) : handle) },
        async *values() {
            for await (const child of base.values()) if (!mounts.has(child.name)) yield child
            yield* mounts.values()
        },
        async getDirectoryHandle(name, options) {
            const mounted = mounts.get(name)
            if (mounted) { if (mounted.kind !== "directory") throw new DOMException("Not a directory", "TypeMismatchError"); return mounted }
            return base.getDirectoryHandle(name, options)
        },
        async getFileHandle(name, options) {
            if (mounts.has(name)) throw new DOMException("Not a file", "TypeMismatchError")
            return base.getFileHandle(name, options)
        },
        async removeEntry(name, options) {
            if (mounts.has(name)) throw new DOMException("System mount", "NoModificationAllowedError")
            await base.removeEntry(name, options)
        },
    }
}
export async function delete_computer_files(id: string): Promise<void> {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid computer ID")
    await (await computer_storage()).removeEntry(id, { recursive: true })
}
