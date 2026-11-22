/*
 * The file system channel: answers the page's `fs` requests against the Pi's real disk.
 *
 * Entities
 *   Fs_Error        a failure carrying the errno-like code the page maps onto File System Access errors
 *   confine         turns a requested path into a normalised absolute path inside the configured root
 *   handle_fs       runs one request and returns its result; rejects with Fs_Error
 *   read_text       reads a small plain file as text (the scripts the runner starts)
 *
 * Limits
 *   Runs as the agent's Unix user: the operating system's permissions are the real access control, the root only narrows it.
 *   Symbolic links are followed only while they stay inside the root. Chunks are at most fs_chunk_bytes of raw data.
 */
import * as fs from "fs/promises"
import * as path from "path"
import { fs_chunk_bytes } from "../../shared/protocol/wire.ts"
import type { Fs_Code, Fs_Entry, Fs_Kind, Fs_Request, Fs_Result, Fs_Stat } from "../../shared/protocol/wire.ts"
import { from_base64, to_base64 } from "../../shared/protocol/codec.ts"

const known_codes = new Set<string>(["ENOENT", "EEXIST", "ENOTDIR", "EISDIR", "ENOTEMPTY", "EACCES", "EROFS", "EINVAL", "EFBIG", "EIO"])

export class Fs_Error extends Error {
    readonly code: Fs_Code
    constructor(code: Fs_Code, message: string) {
        super(message)
        this.name = "Fs_Error"
        this.code = code
    }
}

function to_fs_error(error: unknown): Fs_Error {
    if (error instanceof Fs_Error) return error
    // fs.cp reports its own ERR_FS_CP_* codes
    const code = ((error as NodeJS.ErrnoException)?.code ?? "").replace(/^ERR_FS_CP_/, "")
    if (code === "EPERM") return new Fs_Error("EACCES", "Operation not permitted")
    if (known_codes.has(code)) return new Fs_Error(code as Fs_Code, (error as Error).message)
    return new Fs_Error("EIO", error instanceof Error ? error.message : "I/O error")
}

function inside(root: string, target: string): boolean {
    return root === "/" || target === root || target.startsWith(root + "/")
}

// Lexical check first, then the deepest existing ancestor is resolved so a symlink cannot lead out of the root
export async function confine(root: string, requested: unknown): Promise<string> {
    if (typeof requested !== "string" || !requested.startsWith("/") || requested.includes("\0") || requested.length > 4096) throw new Fs_Error("EINVAL", "Paths must be absolute")
    const target = path.posix.normalize(requested).replace(/(.)\/+$/, "$1")
    if (!inside(root, target)) throw new Fs_Error("EACCES", "Outside the server root")
    if (root === "/") return target
    let probe = target
    while (true) {
        try {
            const real = await fs.realpath(probe)
            if (!inside(await fs.realpath(root), real)) throw new Fs_Error("EACCES", "Outside the server root")
            return target
        } catch (error) {
            if (error instanceof Fs_Error) throw error
            if ((error as NodeJS.ErrnoException).code !== "ENOENT" || probe === "/") throw to_fs_error(error)
            probe = path.posix.dirname(probe)
        }
    }
}

const kind_of = (stats: { isFile(): boolean, isDirectory(): boolean }): Fs_Kind => stats.isFile() ? "file" : stats.isDirectory() ? "dir" : "other"

async function stat_of(target: string): Promise<Fs_Stat> {
    const stats = await fs.stat(target)
    const writable = await fs.access(target, fs.constants.W_OK).then(() => true, () => false)
    return { kind: kind_of(stats), size: stats.size, mtime: Math.round(stats.mtimeMs), mode: stats.mode & 0o7777, writable }
}

async function list_of(target: string): Promise<Fs_Entry[]> {
    const names = await fs.readdir(target)
    const entries = await Promise.all(names.map(async (name): Promise<Fs_Entry | null> => {
        // A broken link or a file that vanished is skipped instead of failing the whole folder
        const stats = await fs.stat(path.posix.join(target, name)).catch(() => null)
        return stats ? { name, kind: kind_of(stats), size: stats.size, mtime: Math.round(stats.mtimeMs) } : null
    }))
    return entries.filter((entry): entry is Fs_Entry => entry !== null).sort((a, b) => a.name.localeCompare(b.name))
}

async function read_of(target: string, offset: number, length: number): Promise<Fs_Result> {
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(length) || length < 0) throw new Fs_Error("EINVAL", "Bad range")
    const handle = await fs.open(target, "r")
    try {
        const stats = await handle.stat()
        if (stats.isDirectory()) throw new Fs_Error("EISDIR", "Is a directory")
        const wanted = Math.min(length, fs_chunk_bytes, Math.max(0, stats.size - offset))
        const buffer = Buffer.alloc(wanted)
        const { bytesRead } = wanted ? await handle.read(buffer, 0, wanted, offset) : { bytesRead: 0 }
        return { op: "read", data: to_base64(buffer.subarray(0, bytesRead)), size: stats.size, eof: offset + bytesRead >= stats.size }
    } finally { await handle.close() }
}

async function write_of(target: string, offset: number, data: string, truncate: boolean): Promise<Fs_Result> {
    if (!Number.isInteger(offset) || offset < 0) throw new Fs_Error("EINVAL", "Bad offset")
    if (typeof data !== "string" || data.length > Math.ceil(fs_chunk_bytes * 4 / 3) + 8) throw new Fs_Error("EFBIG", "Chunk too large")
    let bytes: Uint8Array
    try { bytes = from_base64(data) } catch { throw new Fs_Error("EINVAL", "Bad base64") }
    const handle = await fs.open(target, truncate ? "w" : "r+")
    try {
        if (bytes.length) await handle.write(bytes, 0, bytes.length, offset)
        return { op: "write", size: (await handle.stat()).size }
    } finally { await handle.close() }
}

// rmdir keeps ENOTEMPTY for a folder that still has content; rm would answer with a Node-specific code
async function remove_of(target: string, recursive: boolean): Promise<void> {
    if (recursive) return fs.rm(target, { recursive: true, force: false })
    if ((await fs.lstat(target)).isDirectory()) return fs.rmdir(target)
    return fs.unlink(target)
}

async function run(root: string, request: Fs_Request): Promise<Fs_Result> {
    const target = await confine(root, request.path)
    switch (request.op) {
        case "stat": return { op: "stat", stat: await stat_of(target) }
        case "list": return { op: "list", entries: await list_of(target) }
        case "read": return read_of(target, request.offset, request.length)
        case "write": return write_of(target, request.offset, request.data, request.truncate === true)
        case "mkdir": await fs.mkdir(target); return { op: "mkdir" }
        case "remove": await remove_of(target, request.recursive === true); return { op: "remove" }
        case "rename": await fs.rename(target, await confine(root, request.to)); return { op: "rename" }
        case "copy": await fs.cp(target, await confine(root, request.to), { recursive: true, errorOnExist: true, force: false }); return { op: "copy" }
        default: throw new Fs_Error("EINVAL", "Unknown operation")
    }
}

// The whole text of a small file, for the script runner: confined like every other path, and refused when it is not a plain file
export async function read_text(root: string, requested: unknown, limit = 1024 * 1024): Promise<string> {
    const target = await confine(root, requested)
    try {
        const stats = await fs.stat(target)
        if (!stats.isFile()) throw new Fs_Error("EISDIR", "Not a file")
        if (stats.size > limit) throw new Fs_Error("EFBIG", "The file is too large")
        return await fs.readFile(target, "utf8")
    } catch (error) { throw to_fs_error(error) }
}

export async function handle_fs(root: string, request: Fs_Request): Promise<Fs_Result> {
    try { return await run(root, request) } catch (error) { throw to_fs_error(error) }
}
