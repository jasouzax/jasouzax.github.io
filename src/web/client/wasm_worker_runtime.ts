import { io_chunk, errno } from "./wasm_protocol.ts"
import type { descriptor, worker_start } from "./wasm_protocol.ts"

// Generated Emscripten objects deliberately stay at this external ABI boundary.
type em_object = any

export async function run_worker_runtime(start: worker_start, send: (value: unknown) => void, create: (options: any) => Promise<any>, applet = false): Promise<void> {
    const control = new Int32Array(start.shared, 0, 4)
    const payload = new Uint8Array(start.shared, 16)
    const decoder = new TextDecoder()
    let m: em_object
    let memory: WebAssembly.Memory
    function call(op: string, args: unknown = {}): any {
        if (op === "exec" || op === "spawn") args = { ...(args as object), descriptors: descriptors(), cwd: m.FS.cwd() }
        Atomics.store(control, 0, 0)
        send({ op, args })
        while (Atomics.load(control, 0) === 0) Atomics.wait(control, 0, 0)
        const reply = JSON.parse(decoder.decode(payload.slice(0, Atomics.load(control, 1))))
        if (reply.error) {
            if (reply.error === errno.EINTR && m?._jazu_interrupt && /^(?:.*\/)?(?:sh|ash)$/.test(start.argv[0])) { Atomics.store(control, 2, 0); m._jazu_interrupt() }
            throw new m.FS.ErrnoError(reply.error)
        }
        return reply.value
    }
    const descriptors = () => m.FS.streams.filter(Boolean).map((s: em_object) => ({ fd: s.fd, handle: s.jazu_handle, path: s.path, flags: s.flags, mode: s.node.mode, position: s.position, tty: !!s.tty }))
    try {
        m = await create({
            noInitialRun: true, noFSInit: true, thisProgram: applet ? "busybox" : start.argv[0],
            jazu: { pid: start.pid, ppid: start.ppid, call, control },
            preRun: [(runtime: em_object) => Object.assign(runtime.ENV, start.env)],
            instantiateWasm(imports: WebAssembly.Imports, done: (instance: WebAssembly.Instance) => void) {
                const instance = new WebAssembly.Instance(start.module, imports)
                memory = Object.values(instance.exports).find(value => value instanceof WebAssembly.Memory) as WebAssembly.Memory
                done(instance)
                return instance.exports
            },
            print: (text: string) => send({ op: "diagnostic", args: { text: text + "\n" } }),
            printErr: (text: string) => send({ op: "diagnostic", args: { text: text + "\n" } }),
        })
        const FS = m.FS
        const path_of = (node: em_object): string => node.parent === node ? "/" : `${path_of(node.parent).replace(/\/$/, "")}/${node.name}`
        const attributes = (path: string, handle?: number): em_object => {
            const info = handle === undefined ? call("stat", { path }) : call("fstat", { handle })
            const now = new Date(info.mtime ?? 0)
            return { dev: 1, ino: info.ino, mode: info.mode, nlink: 1, uid: info.uid ?? 1000, gid: info.gid ?? 1000, rdev: 0, size: info.size, atime: now, mtime: now, ctime: now, blksize: 4096, blocks: Math.ceil(info.size / 512) }
        }
        const tty = { ops: {
            ioctl_tcgets: () => call("termios"),
            ioctl_tcsets: (_tty: unknown, _op: unknown, value: unknown) => { call("termios", { value }); return 0 },
            ioctl_tiocgwinsz: () => call("winsize"),
        } }
        const stream_ops: em_object = {
            getattr: (stream: em_object) => attributes(stream.path, stream.jazu_handle),
            open(stream: em_object) {
                stream.jazu_handle = call("open", { path: stream.path, flags: stream.flags })
                if (call("isatty", { handle: stream.jazu_handle })) { stream.tty = tty; stream.seekable = false }
            },
            close: (stream: em_object) => call("close", { handle: stream.jazu_handle }),
            dup: (stream: em_object) => call("retain", { handle: stream.jazu_handle }),
            read(stream: em_object, buffer: Uint8Array, offset: number, length: number) {
                const bytes = call("read", { handle: stream.jazu_handle, length: Math.min(length, io_chunk) })
                buffer.set(bytes, offset)
                return bytes.length
            },
            write(stream: em_object, buffer: Uint8Array, offset: number, length: number) {
                let written = 0
                while (written < length) {
                    const count = Math.min(length - written, io_chunk)
                    written += call("write", { handle: stream.jazu_handle, bytes: Array.from(buffer.subarray(offset + written, offset + written + count)) })
                }
                return written
            },
            llseek: (stream: em_object, offset: number, whence: number) => call("seek", { handle: stream.jazu_handle, offset, whence }),
            ioctl: () => { throw new FS.ErrnoError(errno.ENOTTY) },
        }
        const node_ops: em_object = {
            getattr: (node: em_object) => attributes(path_of(node)),
            setattr(node: em_object, attr: em_object) { call("setattr", { path: path_of(node), mode: attr.mode, size: attr.size, timestamp: attr.timestamp, uid: attr.uid, gid: attr.gid }); if (attr.mode !== undefined) node.mode = attr.mode },
            lookup(parent: em_object, name: string) { const path = `${path_of(parent).replace(/\/$/, "")}/${name}`; return make_node(parent, name, attributes(path).mode) },
            mknod(parent: em_object, name: string, mode: number) { call("create", { path: `${path_of(parent).replace(/\/$/, "")}/${name}`, mode }); return make_node(parent, name, mode) },
            readdir: (node: em_object) => [".", "..", ...call("list", { path: path_of(node) })],
            rename(node: em_object, parent: em_object, name: string) { call("rename", { from: path_of(node), to: `${path_of(parent).replace(/\/$/, "")}/${name}` }); node.name = name; node.parent = parent },
            unlink: (parent: em_object, name: string) => call("remove", { path: `${path_of(parent).replace(/\/$/, "")}/${name}`, directory: false }),
            rmdir: (parent: em_object, name: string) => call("remove", { path: `${path_of(parent).replace(/\/$/, "")}/${name}`, directory: true }),
            readlink: (node: em_object) => call("readlink", { path: path_of(node) }),
            symlink: (parent: em_object, name: string, target: string) => call("symlink", { path: `${path_of(parent).replace(/\/$/, "")}/${name}`, target }),
        }
        function make_node(parent: em_object, name: string, mode: number): em_object {
            const node = FS.createNode(parent, name, mode, 0)
            node.node_ops = node_ops
            node.stream_ops = stream_ops
            return node
        }
        // All paths go to the kernel. No second MEMFS copy of /home or /tmp.
        FS.root = null
        FS.nameTable = new Array(4096)
        FS.streams = []
        FS.mount({ mount: () => make_node(null, "/", 0o40755) }, {}, "/")
        // A long-running shell can cache /home/user before a folder is connected
        // or authorized. Built-in redirection must use the current mount's mode,
        // just as a newly started utility (such as touch) does.
        const node_permissions = FS.nodePermissions.bind(FS)
        FS.nodePermissions = (node: em_object, permissions: string) => {
            node.mode = attributes(path_of(node)).mode
            return node_permissions(node, permissions)
        }
        FS.currentPath = start.cwd
        const original_chdir = FS.chdir.bind(FS)
        FS.chdir = (path: string) => { original_chdir(path); call("chdir", { path: FS.cwd() }) }
        const install = (d: descriptor) => {
            const node = make_node(FS.root, d.path.split("/").pop() || "fd", d.mode)
            // Pipe and tty nodes are descriptors, not directory entries.
            node.parent = FS.root
            FS.createStream({ node, path: d.path, flags: d.flags, seekable: !d.tty && d.mode !== 0o10600, position: d.position,
                jazu_handle: d.handle, stream_ops, tty: d.tty ? tty : undefined }, d.fd)
        }
        for (const d of start.snapshot?.descriptors ?? start.descriptors) install(d)
        m.PIPEFS.createPipe = () => {
            const handles = call("pipe")
            const read = FS.nextfd()
            install({ fd: read, handle: handles[0], path: "pipe", flags: 0, mode: 0o10600, position: 0, tty: false })
            const write = FS.nextfd()
            install({ fd: write, handle: handles[1], path: "pipe", flags: 1, mode: 0o10600, position: 0, tty: false })
            return { readable_fd: read, writable_fd: write }
        }
        m.jazu = {
            pid: start.pid, ppid: start.ppid, call, control,
            fork(continuation: Record<string, number>) {
                const state = { memory: new Uint8Array(memory.buffer).slice(), stack: m.stackSave(), descriptors: descriptors(), cwd: FS.cwd(), continuation: Object.values(continuation) }
                return call("fork", state)
            },
        }
        Object.assign(m.ENV, start.env)
        let code = 0
        try {
            if (start.snapshot) {
                const saved = start.snapshot
                if (memory!.buffer.byteLength < saved.memory.length) {
                    // Memory is exported by the generated module through HEAPU8;
                    // use the C realloc-free heap growth helper before restoring.
                    m._emscripten_resize_heap(saved.memory.length)
                }
                new Uint8Array(memory!.buffer).set(saved.memory)
                m.stackRestore(saved.stack)
                m._jazu_child(...saved.continuation)
            } else code = m.callMain(applet ? [...start.argv] : start.argv.slice(1)) ?? 0
        } catch (error) {
            if (typeof (error as { status?: unknown }).status !== "number") throw error
            code = (error as { status: number }).status
        }
        send({ exit: code })
    } catch (error) {
        send({ failure: error instanceof Error ? error.stack ?? error.message : String(error) })
    }
}

