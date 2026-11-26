/** Browser-owned state is separate from the files transferred when home is connected. */
import type { dir_handle } from "./opfs.ts"
export const computes_storage_name = ".computes"
export async function browser_home_directory(): Promise<dir_handle> {
    const root = await navigator.storage.getDirectory()
    const allowed = (name: string) => { if (name === computes_storage_name) throw new DOMException("Reserved browser storage", "NotFoundError") }
    const handle: dir_handle & { isSameEntry: (other: dir_handle) => Promise<boolean>, resolve: (other: dir_handle) => Promise<string[] | null> } = { kind: "directory", name: root.name, native_handle: root,
        async *values() { for await (const entry of (root as unknown as dir_handle).values()) if (entry.name !== computes_storage_name) yield entry },
        async getFileHandle(name, options) { allowed(name); return root.getFileHandle(name, options) },
        async getDirectoryHandle(name, options) { allowed(name); return root.getDirectoryHandle(name, options) },
        async removeEntry(name, options) { allowed(name); await root.removeEntry(name, options) },
        isSameEntry: other => root.isSameEntry((other.native_handle || other) as unknown as FileSystemHandle),
        resolve: other => root.resolve((other.native_handle || other) as unknown as FileSystemHandle),
    }
    return handle
}
