import type { dir_handle, file_handle } from "./desk_fs.ts"

// File System Access-shaped handles backed only by memory. Nothing here opens OPFS,
// IndexedDB, localStorage, a network request or a user folder.
export type memory_handle = dir_handle & { mount(name: string, handle: dir_handle | file_handle): void }

export function named_directory(name: string, handle: dir_handle): dir_handle {
    return {
        kind: "directory", name,
        native_handle: handle.native_handle ?? handle,
        values: () => handle.values(),
        getFileHandle: (name, options) => handle.getFileHandle(name, options),
        getDirectoryHandle: (name, options) => handle.getDirectoryHandle(name, options),
        removeEntry: (name, options) => handle.removeEntry(name, options),
        ...(handle.queryPermission ? { queryPermission: (options: { mode: string }) => handle.queryPermission!(options) } : {}),
        ...(handle.requestPermission ? { requestPermission: (options: { mode: string }) => handle.requestPermission!(options) } : {}),
    }
}

export function memory_directory(name: string): memory_handle {
    const children = new Map<string, dir_handle | file_handle>()
    const valid = (name: string) => { if (!name || /[/\\\0]/.test(name) || [".", ".."].includes(name)) throw new DOMException("Invalid name", "TypeError") }
    const directory: memory_handle = {
        kind: "directory", name,
        mount(name, handle) { valid(name); children.set(name, handle.kind === "directory" && handle.name !== name ? named_directory(name, handle) : handle) },
        async *values() { yield* children.values() },
        async getFileHandle(name, options) {
            valid(name)
            let handle = children.get(name)
            if (handle && handle.kind !== "file") throw new DOMException("Not a file", "TypeMismatchError")
            if (!handle) {
                if (!options?.create) throw new DOMException("Not found", "NotFoundError")
                let data = new Blob()
                let modified = Date.now()
                const file: file_handle = { kind: "file", name,
                    async getFile() { return new File([data], name, { type: data.type, lastModified: modified }) },
                    async createWritable() {
                        let next = data
                        return { async write(value) { next = typeof value === "string" ? new Blob([value]) : value }, async close() { data = next; modified = Math.max(Date.now(), modified + 1) } }
                    },
                }
                handle = file
                children.set(name, handle)
            }
            return handle as file_handle
        },
        async getDirectoryHandle(name, options) {
            valid(name)
            let handle = children.get(name)
            if (handle && handle.kind !== "directory") throw new DOMException("Not a directory", "TypeMismatchError")
            if (!handle) {
                if (!options?.create) throw new DOMException("Not found", "NotFoundError")
                handle = memory_directory(name)
                children.set(name, handle)
            }
            return handle as dir_handle
        },
        async removeEntry(name, options) {
            const handle = children.get(name)
            if (!handle) throw new DOMException("Not found", "NotFoundError")
            if (handle.kind === "directory" && !options?.recursive) {
                for await (const child of handle.values()) throw new DOMException("Directory is not empty", "InvalidModificationError")
            }
            children.delete(name)
        },
    }
    return directory
}
