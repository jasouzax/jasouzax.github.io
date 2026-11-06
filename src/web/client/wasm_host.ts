import type { proc_api, program, stat_info } from "./proc_types.ts"
import type { descriptor, fork_state, wasm_image, worker_message, worker_start } from "./wasm_protocol.ts"
import { rpc_capacity, errno, error_number } from "./wasm_protocol.ts"
import { proc_record, browser_system } from "./wasm_procfs.ts"

const encoder = new TextEncoder()
type byte_queue = { chunks: Uint8Array[], readers: (() => void)[], writers: number, size: number }
type terminal = { termios: any, cols: number, rows: number, pending: Uint8Array, line: string, decoder: TextDecoder }
type handle = { refs: number, path: string, flags: number, offset: number, kind: "file" | "pipe_read" | "pipe_write" | "stdin" | "stdout" | "stderr" | "null" | "zero" | "random", queue?: byte_queue, terminal?: terminal, proc?: proc_api }
const handles = new Map<number, handle>()
let next_handle = 1
const metadata = new Map<string, { mode?: number, mtime?: number }>()
const inode = new Map<string, number>()
const modules = new Map<string, Promise<WebAssembly.Module>>()
const executables = new Map<string, wasm_image>()
const file_locks = new Map<string, Promise<void>>()
async function with_file<T>(path: string, operation: () => Promise<T>): Promise<T> {
    const previous = file_locks.get(path) ?? Promise.resolve()
    let release!: () => void
    const next = new Promise<void>(resolve => { release = resolve })
    file_locks.set(path, next)
    await previous
    try { return await operation() }
    finally { release(); if (file_locks.get(path) === next) file_locks.delete(path) }
}
export const registered_programs: Record<string, program> = {}
export function inherit_descriptors(descriptors: descriptor[]): descriptor[] {
    for (const descriptor of descriptors) get(descriptor.handle).refs++
    return descriptors
}
type worker_like = { postMessage(value: unknown): void, terminate(): unknown, onmessage: ((event: MessageEvent<worker_message>) => void) | null, onerror: ((event: any) => void) | null }
export type worker_factory = (url: string) => worker_like
const make_worker: worker_factory = url => new Worker(url)

export function register_wasm(image: wasm_image, factory: worker_factory = make_worker): void {
    for (const name of image.commands) {
        executables.set(`/bin/${name}`, image)
        registered_programs[name] = p => run_wasm(p, image, factory)
    }
}

async function compiled(image: wasm_image): Promise<WebAssembly.Module> {
    const key = `${image.id}@${image.version}:${image.sha256}`
    let promise = modules.get(key)
    if (!promise) {
        promise = (async () => {
            const response = await fetch(image.wasm)
            if (!response.ok) throw new Error(`WASM fetch failed: ${response.status}`)
            const bytes = await response.arrayBuffer()
            const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("")
            if (hash !== image.sha256) throw new Error(`WASM integrity failed: ${image.id}`)
            return WebAssembly.compile(bytes)
        })()
        modules.set(key, promise)
        promise.catch(() => modules.delete(key))
    }
    return promise
}

function allocate(value: Omit<handle, "refs">): number { const id = next_handle++; handles.set(id, { ...value, refs: 1 }); return id }
function get(id: number): handle { const h = handles.get(id); if (!h) throw new Error("EBADF"); return h }
function release(id: number): void {
    const h = get(id)
    if (--h.refs) return
    handles.delete(id)
    if (h.kind === "pipe_write") { h.queue!.writers--; for (const wake of h.queue!.readers.splice(0)) wake() }
}
const norm = (path: string): string => {
    const parts: string[] = []
    for (const part of path.split("/")) { if (part === "..") parts.pop(); else if (part && part !== ".") parts.push(part) }
    return "/" + parts.join("/")
}

export async function run_wasm(p: proc_api, initial: wasm_image, factory: worker_factory = make_worker): Promise<number> {
    if (typeof SharedArrayBuffer === "undefined") throw new Error("The WASM terminal requires cross-origin isolation. Serve the site with its generated COOP and COEP response headers.")
    let active: worker_like | null = null
    let active_control: Int32Array | null = null
    let stopped = false
    const owned = new Map<number, number>()
    const children = new Map<number, { done: Promise<number>, code?: number }>()
    const controller = new AbortController()
    let interrupt_read: (() => void) | null = null
    const tty: terminal = { cols: 80, rows: 24, pending: new Uint8Array(), line: "", decoder: new TextDecoder(), termios: { c_iflag: 0x500, c_oflag: 5, c_cflag: 0xbf, c_lflag: 0x8a3b, c_cc: [3,28,127,21,4,0,1,0,17,19,26] } }
    const own = (id: number) => { owned.set(id, (owned.get(id) ?? 0) + 1); return id }
    const retain = (id: number) => { get(id).refs++; own(id); return id }
    const close = (id: number) => { const count = owned.get(id) ?? 0; if (!count) throw new Error("EBADF"); if (count === 1) owned.delete(id); else owned.set(id, count - 1); release(id) }
    let descriptors = p.wasm?.descriptors
    if (descriptors) for (const d of descriptors) own(d.handle)
    else descriptors = ["stdin", "stdout", "stderr"].map((kind, fd) => ({ fd, handle: own(allocate({ path: "/dev/tty", flags: fd ? 1 : 0, offset: 0, kind: kind as handle["kind"], proc: p, terminal: p.interactive ? tty : undefined })), path: "/dev/tty", flags: fd ? 1 : 0, mode: 0o20666, position: 0, tty: p.interactive }))
    const terminal_state = get(descriptors[0].handle).terminal ?? tty
    p.resize = (cols, rows) => { terminal_state.cols = cols; terminal_state.rows = rows }
    p.on_interrupt(() => {
        if (/^(?:.*\/)?(?:sh|ash)$/.test(p.argv[0])) {
            if (active_control) Atomics.store(active_control, 2, 1)
            interrupt_read?.()
        } else p.kill(p.pid, 130)
    })

    async function fs_read(path: string): Promise<Uint8Array> {
        const record = proc_record(p.list_procs(), path)
        if (record !== null) return encoder.encode(record)
        if (!p.fs.read_bytes) throw new Error("Binary filesystem API unavailable")
        return p.fs.read_bytes(path)
    }
    async function fs_write(path: string, bytes: Uint8Array): Promise<void> {
        if (!p.fs.write_bytes) throw new Error("Binary filesystem API unavailable")
        await p.fs.write_bytes(path, bytes)
    }
    async function stat(path: string): Promise<any> {
        path = norm(path)
        const device = /^\/dev\/(null|zero|random|urandom|tty|stdin|stdout|stderr)$/.test(path)
        const record = proc_record(p.list_procs(), path)
        const proc_dir = /^\/proc\/(\d+)$/.exec(path)
        const info: stat_info | null = device ? { kind: "file", size: 0, writable: true } : record !== null ? { kind: "file", size: encoder.encode(record).length, writable: false } : proc_dir && p.list_procs().some(item => item.pid === Number(proc_dir[1])) ? { kind: "dir", size: 0, writable: false } : await p.fs.stat(path)
        if (!info) throw new Error("ENOENT")
        if (!inode.has(path)) inode.set(path, inode.size + 1)
        const saved = metadata.get(path)
        return { size: info.size, ino: inode.get(path), uid: info.uid ?? 1000, gid: info.gid ?? 1000, mode: saved?.mode ?? (device ? 0o20666 : info.kind === "dir" ? (info.writable ? 0o40755 : 0o40555) : executables.has(path) ? 0o100755 : info.writable ? 0o100644 : 0o100444), mtime: saved?.mtime ?? Date.now() }
    }
    async function read(h: handle, length: number): Promise<Uint8Array> {
        if (h.kind === "null") return new Uint8Array()
        if (h.kind === "zero") return new Uint8Array(length)
        if (h.kind === "random") return crypto.getRandomValues(new Uint8Array(length))
        if (h.kind === "pipe_read") {
            const q = h.queue!
            while (!stopped && !q.chunks.length && q.writers) await new Promise<void>(resolve => { q.readers.push(resolve); controller.signal.addEventListener("abort", () => resolve(), { once: true }) })
            if (stopped) return new Uint8Array()
            const chunk = q.chunks.shift() ?? new Uint8Array()
            const part = chunk.subarray(0, length)
            if (part.length < chunk.length) q.chunks.unshift(chunk.subarray(length))
            q.size -= part.length
            return part
        }
        if (h.kind === "stdin") {
            const t = h.terminal
            const pending = t?.pending ?? new Uint8Array()
            if (pending.length) { const part = pending.slice(0, length); if (t) t.pending = pending.slice(length); return part }
            let interrupted = false
            interrupt_read = () => { interrupted = true; h.proc!.stdin.eof() }
            const abort_read = () => h.proc!.stdin.eof()
            controller.signal.addEventListener("abort", abort_read, { once: true })
            const chunk = await h.proc!.stdin.read()
            controller.signal.removeEventListener("abort", abort_read)
            interrupt_read = null
            if (interrupted) throw new Error("EINTR")
            if (chunk === null) return new Uint8Array()
            let text = chunk.replace(/\r/g, "\n")
            if (t && (t.termios.c_lflag & 2)) {
                let ready = ""
                for (const char of text) {
                    if (char === "\x04") { ready += t.line; t.line = ""; if (!ready) return new Uint8Array(); break }
                    if (char === "\x7f" || char === "\b") {
                        if (t.line) { t.line = t.line.slice(0, -1); if (t.termios.c_lflag & 8) h.proc!.stdout.write("\b \b") }
                    } else {
                        t.line += char
                        if (t.termios.c_lflag & 8) h.proc!.stdout.write(char)
                        if (char === "\n") { ready += t.line; t.line = "" }
                    }
                }
                if (!ready) return read(h, length)
                text = ready
            }
            let bytes = encoder.encode(text)
            if (t) { t.pending = bytes.slice(length); bytes = bytes.slice(0, length) }
            return bytes
        }
        if (h.kind !== "file") throw new Error("EBADF")
        return with_file(h.path, async () => {
            const bytes = await fs_read(h.path)
            const part = bytes.slice(h.offset, h.offset + length)
            h.offset += part.length
            return part
        })
    }
    async function dispatch(op: string, a: any): Promise<any> {
        switch (op) {
            case "identity": return { uid: p.uid ?? 1000, gid: p.gid ?? 1000 }
            case "account": {
                let source = ""
                try { source = await p.fs.read(a.group ? "/etc/group" : "/etc/passwd") } catch { return null }
                const lines = source.split("\n").filter(line => line && !line.startsWith("#"))
                if (a.index >= 0) return lines[a.index] ?? null
                return lines.find(line => { const fields = line.split(":"); return a.name === null ? Number(fields[2]) === a.id : fields[0] === a.name }) ?? null
            }
            case "system": return browser_system(p.list_procs())
            case "poll": {
                const ready = () => a.entries.map((entry: { handle: number, events: number }) => {
                    if (entry.handle < 0) return 0
                    const handle = handles.get(entry.handle)
                    if (!handle) return 32
                    let flags = entry.events & 4
                    if (entry.events & 1) {
                        if (handle.kind === "stdin") { if ((handle.terminal?.pending.length ?? 0) > 0 || handle.proc?.stdin.available?.()) flags |= 1 }
                        else if (handle.kind === "pipe_read") { if (handle.queue!.chunks.length || !handle.queue!.writers) flags |= 1 }
                        else flags |= 1
                    }
                    return flags
                })
                const deadline = a.timeout < 0 ? Infinity : performance.now() + a.timeout
                let flags = ready()
                while (!stopped && !flags.some(Boolean) && performance.now() < deadline) {
                    await new Promise<void>(resolve => {
                        const done = () => { clearTimeout(timer); controller.signal.removeEventListener("abort", done); resolve() }
                        const timer = setTimeout(done, Math.min(20, deadline-performance.now()))
                        controller.signal.addEventListener("abort", done, { once: true })
                    })
                    flags = ready()
                }
                return flags
            }
            case "diagnostic": p.stderr.write(a.text); return 0
            case "stat": return stat(a.path)
            case "list": {
                if (a.path === "/proc") return ["uptime", "meminfo", "cpuinfo", "version", ...p.list_procs().map(item => String(item.pid))]
                if (/^\/proc\/\d+$/.test(a.path)) return ["cmdline", "status", "stat"]
                const entries = (await p.fs.list(a.path)).map(e => e.name)
                if (a.path === "/dev") for (const name of ["null", "zero", "random", "urandom", "tty", "stdin", "stdout", "stderr"]) if (!entries.includes(name)) entries.push(name)
                return entries
            }
            case "create": {
                const path = norm(a.path)
                if ((a.mode & 0o170000) === 0o40000) await p.fs.mkdir(path)
                else await fs_write(path, new Uint8Array())
                metadata.set(path, { mode: a.mode, mtime: Date.now() })
                return 0
            }
            case "setattr": {
                const path = norm(a.path)
                const record = proc_record(p.list_procs(), path)
                const info: stat_info | null = record === null ? await p.fs.stat(path) : { kind: "file", size: 0, writable: false }
                if (!info) throw new Error("ENOENT")
                if (!info.writable) throw new Error("EROFS")
                if ((a.uid !== undefined || a.gid !== undefined) && p.fs.chown) await p.fs.chown(path, a.uid ?? info.uid ?? 1000, a.gid ?? info.gid ?? 1000)
                if (a.size !== undefined) await with_file(path, async () => { const old = await fs_read(path); const bytes = new Uint8Array(a.size); bytes.set(old.subarray(0, a.size)); await fs_write(path, bytes) })
                metadata.set(path, { ...metadata.get(path), ...(a.mode === undefined ? {} : { mode: a.mode }), mtime: a.timestamp ?? Date.now() })
                return 0
            }
            case "open": {
                const path = norm(a.path)
                const device = path.startsWith("/dev/") ? path.slice(5) : ""
                if (["stdin", "stdout", "stderr", "tty"].includes(device)) {
                    const fd = device === "stdout" ? 1 : device === "stderr" ? 2 : (a.flags & 3) === 1 ? 1 : 0
                    return retain(descriptors![fd].handle)
                }
                const kind: handle["kind"] = device === "null" ? "null" : device === "zero" ? "zero" : ["random", "urandom"].includes(device) ? "random" : "file"
                const record = proc_record(p.list_procs(), path)
                const proc_dir = /^\/proc\/\d+$/.test(path) && p.list_procs().some(item => path === `/proc/${item.pid}`)
                const info = record !== null ? { writable: false } : proc_dir ? { writable: false } : await p.fs.stat(path)
                if (kind === "file" && (!info || ((a.flags & 3) !== 0 && !info.writable))) throw new Error(info ? "EROFS" : "ENOENT")
                return own(allocate({ path, flags: a.flags, offset: 0, kind }))
            }
            case "isatty": return !!get(a.handle).terminal
            case "fstat": {
                const h = get(a.handle)
                if (h.kind === "file") return stat(h.path)
                return { ino: a.handle, size: h.queue?.size ?? 0, mode: h.kind.startsWith("pipe_") ? 0o10600 : 0o20666, mtime: 0 }
            }
            case "retain": return retain(a.handle)
            case "close": close(a.handle); return 0
            case "read": return Array.from(await read(get(a.handle), a.length))
            case "write": {
                const h = get(a.handle), bytes = new Uint8Array(a.bytes)
                if (h.kind === "pipe_write") {
                    if (![...handles.values()].some(other => other.kind === "pipe_read" && other.queue === h.queue)) throw new Error("EPIPE")
                    if (h.queue!.size + bytes.length > 32 * 1024 * 1024) throw new Error("EAGAIN")
                    h.queue!.chunks.push(bytes); h.queue!.size += bytes.length
                    for (const wake of h.queue!.readers.splice(0)) wake()
                } else if (h.kind === "stdout" || h.kind === "stderr") {
                    const text = (h.terminal?.decoder ?? new TextDecoder()).decode(bytes, { stream: true })
                    h.proc![h.kind].write(text)
                } else if (h.kind === "file") {
                    await with_file(h.path, async () => {
                        const old = await fs_read(h.path)
                        const offset = h.flags & 1024 ? old.length : h.offset
                        const next = new Uint8Array(Math.max(old.length, offset + bytes.length))
                        next.set(old); next.set(bytes, offset); await fs_write(h.path, next)
                        h.offset = offset + bytes.length
                    })
                } else if (h.kind !== "null" && h.kind !== "zero" && h.kind !== "random") throw new Error("EBADF")
                return bytes.length
            }
            case "seek": {
                const h = get(a.handle)
                if (h.kind !== "file") throw new Error("ESPIPE")
                const offset = a.offset + (a.whence === 1 ? h.offset : a.whence === 2 ? (await fs_read(h.path)).length : 0)
                if (offset < 0) throw new Error("EINVAL")
                h.offset = offset; return offset
            }
            case "remove": {
                const info = await p.fs.stat(a.path)
                if (!info) throw new Error("ENOENT")
                if (a.directory !== (info.kind === "dir")) throw new Error(a.directory ? "ENOTDIR" : "EISDIR")
                await p.fs.remove(a.path); metadata.delete(a.path); return 0
            }
            case "rename": await p.fs.rename(a.from, a.to); if (metadata.has(a.from)) { metadata.set(a.to, metadata.get(a.from)!); metadata.delete(a.from) }; return 0
            case "readlink": throw new Error("EINVAL")
            case "symlink": throw new Error("ENOSYS")
            case "chdir": p.cwd = norm(a.path); return 0
            case "termios": if (a.value) terminal_state.termios = a.value; return terminal_state.termios
            case "winsize": return [terminal_state.rows, terminal_state.cols]
            case "sleep": await new Promise<void>(resolve => { const timer = setTimeout(resolve, Math.min(a.ms, 2147483647)); controller.signal.addEventListener("abort", () => { clearTimeout(timer); resolve() }, { once: true }) }); return 0
            case "pipe": {
                const queue: byte_queue = { chunks: [], readers: [], writers: 1, size: 0 }
                return [own(allocate({ path: "pipe", flags: 0, offset: 0, kind: "pipe_read", queue })), own(allocate({ path: "pipe", flags: 1, offset: 0, kind: "pipe_write", queue }))]
            }
            case "fork": {
                const snapshot = a as fork_state
                for (const d of snapshot.descriptors) get(d.handle).refs++
                const child = p.spawn(["sh"], { cwd: snapshot.cwd, env: p.env, background: snapshot.continuation[2] === 1, wasm: { descriptors: snapshot.descriptors, snapshot } })
                const entry: { done: Promise<number>, code?: number } = { done: child.done }
                children.set(child.pid, entry)
                child.done.then(code => { entry.code = code })
                return child.pid
            }
            case "spawn": {
                const env = Object.fromEntries(a.env.map((entry: string) => { const at = entry.indexOf("="); return [entry.slice(0, at), entry.slice(at + 1)] }))
                const paths = a.argv[0].includes("/") ? [norm(a.argv[0].startsWith("/") ? a.argv[0] : a.cwd + "/" + a.argv[0])] : (env.PATH ?? "/bin").split(":").map((dir: string) => norm((dir.startsWith("/") ? dir : a.cwd + "/" + dir) + "/" + a.argv[0]))
                const path = paths.find((path: string) => executables.has(path) || (path.startsWith("/bin/") && registered_programs[path.slice(5)]))
                if (!path) return -errno.ENOENT
                for (const d of a.descriptors) get(d.handle).refs++
                const child = p.spawn([path.split("/").pop()!, ...a.argv.slice(1)], { cwd: a.cwd, env, wasm: { descriptors: a.descriptors } })
                const entry: { done: Promise<number>, code?: number } = { done: child.done }
                children.set(child.pid, entry); child.done.then(code => { entry.code = code })
                return child.pid
            }
            case "wait": {
                let eligible = [...children].filter(([pid]) => a.pid < 0 || pid === a.pid)
                if (!eligible.length) return { pid: -1, status: 0 }
                let found = eligible.find(([, entry]) => entry.code !== undefined)
                if (!found && (a.flags & 1)) return { pid: 0, status: 0 }
                if (!found) { const pid = await Promise.race(eligible.map(async ([pid, entry]) => { await entry.done; return pid })); found = [pid, children.get(pid)!] }
                children.delete(found[0])
                const code = found[1].code ?? await found[1].done
                return { pid: found[0], status: code >= 128 ? code - 128 : (code & 255) << 8 }
            }
            case "kill": {
                const target = a.pid === 0 ? p.pid : a.pid
                if (a.sig === 0) return p.list_procs().some(item => item.pid === target) ? 0 : -1
                return p.kill(target, 128 + a.sig) ? 0 : -1
            }
            default: throw new Error("ENOSYS")
        }
    }

    return new Promise<number>((resolve, reject) => {
        const finish = (code: number, failure?: Error) => {
            if (stopped) return
            stopped = true; controller.abort(); active?.terminate()
            for (const [id, count] of owned) for (let n = 0; n < count; n++) release(id)
            owned.clear()
            if (failure) reject(failure); else resolve(code)
        }
        p.signal.addEventListener("abort", () => finish(130), { once: true })
        if (p.signal.aborted) { finish(130); return }
        const launch = async (image: wasm_image, argv: string[], env: Record<string, string>, snapshot?: fork_state) => {
            const module = await compiled(image)
            if (stopped) return
            const worker = factory(image.worker)
            active = worker
            const shared = new SharedArrayBuffer(rpc_capacity)
            const control = new Int32Array(shared, 0, 4)
            active_control = control
            const respond = (value: any, error?: number) => {
                if (stopped || active !== worker) return
                const bytes = encoder.encode(JSON.stringify(error ? { error } : { value: value ?? null }))
                if (bytes.length > shared.byteLength - 16) { respond(null, errno.EIO); return }
                new Uint8Array(shared, 16).set(bytes)
                Atomics.store(control, 1, bytes.length)
                Atomics.store(control, 0, 1); Atomics.notify(control, 0)
            }
            worker.onerror = event => { if (active === worker) finish(1, new Error(event.message ?? "WASM Worker failed")) }
            worker.onmessage = async ({ data }) => {
                if (stopped || active !== worker) return
                if ("exit" in data) { finish(data.exit); return }
                if ("failure" in data) { finish(1, new Error(data.failure)); return }
                try {
                    if (data.op === "exec") {
                        const a = data.args
                        const path = a.file === "/proc/self/exe" ? "/bin/sh" : norm(a.file)
                        const next = executables.get(path)
                        const builtin = path.startsWith("/bin/") ? registered_programs[path.slice(5)] : undefined
                        if ((!next && !builtin) || !(await p.fs.stat(path))) { respond(errno.ENOEXEC); return }
                        descriptors = a.descriptors
                        p.argv = a.argv
                        p.env = Object.fromEntries(a.env.map((entry: string) => { const at = entry.indexOf("="); return [entry.slice(0, at), entry.slice(at + 1)] }))
                        p.cwd = a.cwd
                        worker.terminate()
                        if (!next) {
                            active = null
                            const child = p.spawn([path.slice(5), ...a.argv.slice(1)], { cwd: p.cwd, env: p.env, wasm: { descriptors: descriptors! } })
                            finish(await child.done)
                            return
                        }
                        await launch(next, [path.split("/").pop()!, ...a.argv.slice(1)], p.env).catch(error => finish(1, error))
                        return
                    }
                    const result = await dispatch(data.op, data.args)
                    if (data.op !== "diagnostic") respond(result)
                } catch (error) { respond(null, error_number(error)) }
            }
            worker.postMessage({ shared, module, pid: p.pid, ppid: p.ppid, argv, env, cwd: p.cwd, descriptors: descriptors!, snapshot } satisfies worker_start)
        }
        launch(initial, p.argv, p.env, p.wasm?.snapshot).catch(error => finish(1, error))
    })
}
