// The small, versioned ABI shared by the kernel and compiled program Workers.
export const rpc_capacity = 512 * 1024
export const io_chunk = 32 * 1024
export type descriptor = { fd: number, handle: number, path: string, flags: number, mode: number, position: number, tty: boolean }
export type fork_state = {
    memory: Uint8Array
    stack: number
    continuation: number[]
    descriptors: descriptor[]
    cwd: string
}
export type wasm_image = { id: string, version: string, worker: string, wasm: string, sha256: string, commands: string[], license?: string, source?: string }
export type worker_start = {
    shared: SharedArrayBuffer, module: WebAssembly.Module, pid: number, ppid: number,
    argv: string[], env: Record<string, string>, cwd: string, descriptors: descriptor[], snapshot?: fork_state,
}
export type rpc_request = { op: string, args: any }
export type worker_message = rpc_request | { exit: number } | { failure: string }

// Emscripten errno values (not the host OS's errno numbering).
export const errno = { EACCES: 2, EAGAIN: 6, EBADF: 8, ECHILD: 12, EEXIST: 20, EINTR: 27, EINVAL: 28, EIO: 29, EISDIR: 31, ENOENT: 44, ENOEXEC: 45, ENOSYS: 52, ENOTDIR: 54, ENOTEMPTY: 55, ENOTTY: 59, EPIPE: 64, EROFS: 69, ESPIPE: 70 }

export function error_number(error: unknown): number {
    const message = error instanceof Error ? error.message : String(error)
    const named = Object.keys(errno).find(name => message.includes(name)) as keyof typeof errno | undefined
    if (named) return errno[named]
    if (/Read-only/i.test(message)) return errno.EROFS
    if (/Permission|NotAllowed/i.test(message)) return errno.EACCES
    if (/Not a directory/i.test(message)) return errno.ENOTDIR
    if (/Is a directory/i.test(message)) return errno.EISDIR
    if (/exists/i.test(message)) return errno.EEXIST
    if (/not empty/i.test(message)) return errno.ENOTEMPTY
    if (/No such|Not found/i.test(message)) return errno.ENOENT
    return errno.EIO
}
