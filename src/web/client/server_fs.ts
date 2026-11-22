/*
 * The Pi's file system as File System Access handles, so the desk's file manager, folder windows and editors work on it unchanged.
 *
 * Entities
 *   remote_directory   a dir_handle for an absolute path on the Pi; children are made lazily, nothing is cached except reads
 *   dom_error          maps the Pi's errno-like codes onto the DOMException names the desk already handles
 *   Fs_Client          the one method needed from the link: fs(request) -> result (Server_Link satisfies it)
 * Scope
 *   Every operation is one request (reads and writes are chunked at fs_chunk_bytes). Paths are built here and re-checked by the agent.
 * Limits
 *   A file is read whole when opened (up to max_read_bytes); a bigger one fails with NotReadableError instead of flooding the connection.
 *   Entries that are neither files nor directories (devices, sockets) are not listed. Writes are applied when the stream closes.
 */
import { fs_chunk_bytes } from "../../../shared/protocol/wire.ts"
import type { Fs_Code, Fs_Request, Fs_Result, Fs_Stat } from "../../../shared/protocol/wire.ts"
import { from_base64, to_base64 } from "../../../shared/protocol/codec.ts"
import type { dir_handle, file_handle } from "./desk_fs.ts"

export type Fs_Client = { fs(request: Fs_Request, timeout_ms?: number): Promise<Fs_Result> }
export const max_read_bytes = 32 * 1024 * 1024
const write_timeout_ms = 60_000

const dom_names: Record<Fs_Code | "OFFLINE" | "TIMEOUT", string> = {
    ENOENT: "NotFoundError", EEXIST: "InvalidModificationError", ENOTDIR: "TypeMismatchError", EISDIR: "TypeMismatchError", ENOTEMPTY: "InvalidModificationError",
    EACCES: "NotAllowedError", EROFS: "NotAllowedError", EINVAL: "TypeError", EFBIG: "QuotaExceededError", EIO: "UnknownError", OFFLINE: "NetworkError", TIMEOUT: "TimeoutError",
}

export function dom_error(error: unknown): DOMException {
    if (error instanceof DOMException) return error
    const code = (error as { code?: string })?.code as keyof typeof dom_names | undefined
    return new DOMException(error instanceof Error ? error.message : "I/O error", (code && dom_names[code]) || "UnknownError")
}

async function call<T extends Fs_Result["op"]>(client: Fs_Client, request: Fs_Request, op: T, timeout_ms?: number): Promise<Extract<Fs_Result, { op: T }>> {
    try {
        const result = await client.fs(request, timeout_ms)
        if (result.op !== op) throw new DOMException("Unexpected answer", "UnknownError")
        return result as Extract<Fs_Result, { op: T }>
    } catch (error) { throw dom_error(error) }
}

export function join_path(parent: string, name: string): string {
    if (!name || /[/\\\0]/.test(name) || name === "." || name === "..") throw new DOMException("Invalid name", "TypeError")
    return parent === "/" ? `/${name}` : `${parent}/${name}`
}

function parent_of(path: string): string {
    const index = path.lastIndexOf("/")
    return index <= 0 ? "/" : path.slice(0, index)
}

async function stat_of(client: Fs_Client, path: string): Promise<Fs_Stat | null> {
    try { return (await call(client, { op: "stat", path }, "stat")).stat } catch (error) {
        if ((error as DOMException).name === "NotFoundError") return null
        throw error
    }
}

export function remote_file(client: Fs_Client, path: string, name = path.slice(path.lastIndexOf("/") + 1)): file_handle {
    const handle: file_handle = {
        kind: "file", name,
        async getFile() {
            const stat = (await call(client, { op: "stat", path }, "stat")).stat
            if (stat.kind !== "file") throw new DOMException("Not a file", "TypeMismatchError")
            if (stat.size > max_read_bytes) throw new DOMException("The file is too large to open here", "NotReadableError")
            const parts: Uint8Array<ArrayBuffer>[] = []
            let offset = 0
            while (true) {
                const answer = await call(client, { op: "read", path, offset, length: fs_chunk_bytes }, "read")
                const bytes = from_base64(answer.data) as Uint8Array<ArrayBuffer>
                if (bytes.length) parts.push(bytes)
                offset += bytes.length
                if (answer.eof || bytes.length === 0 || offset > max_read_bytes) break
            }
            return new File(parts, name, { lastModified: stat.mtime })
        },
        async createWritable() {
            const parts: Blob[] = []
            return {
                async write(value: Blob | string) { parts.push(typeof value === "string" ? new Blob([value]) : value) },
                async close() {
                    const blob = new Blob(parts)
                    if (blob.size === 0) { await call(client, { op: "write", path, offset: 0, data: "", truncate: true }, "write", write_timeout_ms); return }
                    for (let offset = 0; offset < blob.size; offset += fs_chunk_bytes) {
                        const chunk = new Uint8Array(await blob.slice(offset, offset + fs_chunk_bytes).arrayBuffer())
                        await call(client, { op: "write", path, offset, data: to_base64(chunk), truncate: offset === 0 }, "write", write_timeout_ms)
                    }
                },
            }
        },
        async move(next: string) { await call(client, { op: "rename", path, to: join_path(parent_of(path), next) }, "rename") },
    }
    return handle
}

export function remote_directory(client: Fs_Client, path = "/", name = path === "/" ? "/" : path.slice(path.lastIndexOf("/") + 1)): dir_handle {
    return {
        kind: "directory", name,
        async *values() {
            const { entries } = await call(client, { op: "list", path }, "list")
            for (const entry of entries) {
                if (entry.kind === "dir") yield remote_directory(client, join_path(path, entry.name), entry.name)
                else if (entry.kind === "file") yield remote_file(client, join_path(path, entry.name), entry.name)
            }
        },
        async getFileHandle(child, options) {
            const target = join_path(path, child)
            const stat = await stat_of(client, target)
            if (stat && stat.kind !== "file") throw new DOMException("Not a file", "TypeMismatchError")
            if (!stat) {
                if (!options?.create) throw new DOMException("Not found", "NotFoundError")
                await call(client, { op: "write", path: target, offset: 0, data: "", truncate: true }, "write")
            }
            return remote_file(client, target, child)
        },
        async getDirectoryHandle(child, options) {
            const target = join_path(path, child)
            const stat = await stat_of(client, target)
            if (stat && stat.kind !== "dir") throw new DOMException("Not a directory", "TypeMismatchError")
            if (!stat) {
                if (!options?.create) throw new DOMException("Not found", "NotFoundError")
                await call(client, { op: "mkdir", path: target }, "mkdir")
            }
            return remote_directory(client, target, child)
        },
        async removeEntry(child, options) { await call(client, { op: "remove", path: join_path(path, child), recursive: options?.recursive === true }, "remove") },
        async move(next: string) { await call(client, { op: "rename", path, to: join_path(parent_of(path), next) }, "rename") },
        // The operating system decides; a denied operation fails with NotAllowedError when it is tried
        async queryPermission() { return "granted" },
        async requestPermission() { return "granted" },
    }
}
