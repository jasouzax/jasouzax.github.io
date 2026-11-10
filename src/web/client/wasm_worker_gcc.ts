import type { worker_start } from "./wasm_protocol.ts"
import { compile_with_llvm } from "./llvm_service.ts"

export async function run_worker(start: worker_start, send: (value: unknown) => void): Promise<void> {
    const control = new Int32Array(start.shared, 0, 4)
    const payload = new Uint8Array(start.shared, 16)
    const decoder = new TextDecoder()
    const encoder = new TextEncoder()

    function call(op: string, args: unknown = {}): any {
        Atomics.store(control, 0, 0)
        send({ op, args })
        while (Atomics.load(control, 0) === 0) Atomics.wait(control, 0, 0)
        const reply = JSON.parse(decoder.decode(payload.slice(0, Atomics.load(control, 1))))
        if (reply.error) {
            throw new Error(`errno: ${reply.error}`)
        }
        return reply.value
    }

    const stdout_desc = start.descriptors.find(d => d.fd === 1)
    const stderr_desc = start.descriptors.find(d => d.fd === 2)

    function write_stdout(text: string) {
        if (stdout_desc) {
            const bytes = encoder.encode(text)
            call("write", { handle: stdout_desc.handle, bytes: Array.from(bytes) })
        } else {
            send({ op: "diagnostic", args: { text } })
        }
    }

    function write_stderr(text: string) {
        if (stderr_desc) {
            const bytes = encoder.encode(text)
            call("write", { handle: stderr_desc.handle, bytes: Array.from(bytes) })
        } else {
            send({ op: "diagnostic", args: { text } })
        }
    }

    function norm_path(path: string): string {
        const parts: string[] = []
        for (const p of path.split("/")) {
            if (p === "..") parts.pop()
            else if (p && p !== ".") parts.push(p)
        }
        return "/" + parts.join("/")
    }

    function resolve_path(p: string): string {
        if (p.startsWith("/")) return norm_path(p)
        return norm_path((start.cwd.replace(/\/+$/, "") || "/") + "/" + p)
    }

    function read_vfs_bytes(path: string): Uint8Array | null {
        try {
            const info = call("stat", { path })
            if (!info) return null
            if ((info.mode & 0o170000) === 0o040000) return null
            const handle = call("open", { path, flags: 0 })
            const bytes: number[] = call("read", { handle, length: info.size })
            call("close", { handle })
            return new Uint8Array(bytes)
        } catch {
            return null
        }
    }

    function write_vfs_bytes(path: string, bytes: Uint8Array): void {
        try {
            call("create", { path, mode: 0o100755 })
        } catch {}
        const handle = call("open", { path, flags: 1 })
        call("write", { handle, bytes: Array.from(bytes) })
        call("close", { handle })
    }

    try {
        const prog = start.argv[0].split("/").pop() || "gcc"
        const args = start.argv.slice(1)
        const is_cxx = /g\+\+|c\+\+|clang\+\+/.test(prog)
        const is_clang = /clang/.test(prog)
        const is_cpp = prog === "cpp"

        let outfile: string | null = null
        let mode = is_cpp ? "preprocess" : "exe"
        let show_version = false
        let show_verbose = false
        let show_help = false
        let dump_version = false
        let dump_machine = false
        let print_dirs = false

        const input_files: string[] = []
        const extra_flags: string[] = []
        const inc_paths: string[] = []

        for (let i = 0; i < args.length; i++) {
            const arg = args[i]
            if (arg === "--version") {
                show_version = true
            } else if (arg === "-v") {
                show_verbose = true
            } else if (arg === "-h" || arg === "--help") {
                show_help = true
            } else if (arg === "-dumpversion") {
                dump_version = true
            } else if (arg === "-dumpmachine") {
                dump_machine = true
            } else if (arg === "-print-search-dirs") {
                print_dirs = true
            } else if (arg === "-o" && i + 1 < args.length) {
                outfile = args[++i]
            } else if (arg.startsWith("-o") && arg.length > 2) {
                outfile = arg.slice(2)
            } else if (arg === "-c") {
                mode = "obj"
                extra_flags.push(arg)
            } else if (arg === "-S") {
                mode = "asm"
                extra_flags.push(arg)
            } else if (arg === "-E") {
                mode = "preprocess"
                extra_flags.push(arg)
            } else if (arg === "-I" && i + 1 < args.length) {
                inc_paths.push(args[++i])
            } else if (arg.startsWith("-I") && arg.length > 2) {
                inc_paths.push(arg.slice(2))
            } else if ((arg === "-target" || arg === "--target" || arg === "-arch" || arg === "-x" || arg === "-sysroot" || arg === "--sysroot") && i + 1 < args.length) {
                extra_flags.push(arg, args[++i])
            } else if (arg.startsWith("-")) {
                extra_flags.push(arg)
            } else {
                input_files.push(arg)
            }
        }

        if (show_help) {
            write_stdout(`Usage: ${prog} [options] file...\nOptions:\n  --help                   Display this information.\n  --version                Display compiler version information.\n  -v                       Display the programs invoked by the compiler.\n  -E                       Preprocess only.\n  -c                       Compile and assemble, but do not link.\n  -o <file>                Place the output into <file>.\n  -I <dir>                 Add <dir> to search path for include files.\n  -O<n>                    Set optimization level to <n>.\n  -Wall                    Enable compiler warnings.\n`)
            send({ exit: 0 })
            return
        }

        if (dump_version) {
            write_stdout("14.2.0\n")
            send({ exit: 0 })
            return
        }

        if (dump_machine) {
            write_stdout("wasm32-unknown-wasi\n")
            send({ exit: 0 })
            return
        }

        if (print_dirs) {
            write_stdout("install: /usr/lib/gcc/wasm32-wasi/14.2.0/\nprograms: =/usr/lib/gcc/wasm32-wasi/14.2.0/:/usr/bin/\nlibraries: =/usr/lib/gcc/wasm32-wasi/14.2.0/:/usr/lib/\n")
            send({ exit: 0 })
            return
        }

        if (show_version) {
            if (is_clang) {
                write_stdout(`clang version 16.0.0 (LLVM 16.0.0 for Jazu Desktop)\nTarget: wasm32-unknown-wasi\nThread model: posix\n`)
            } else if (is_cxx) {
                write_stdout(`g++ (GCC) 14.2.0 (LLVM 16.0.0 Clang backend for Jazu Desktop)\nCopyright (C) 2024 Free Software Foundation, Inc.\nThis is free software; see the source for copying conditions.  There is NO\nwarranty; not even for MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.\n\n`)
            } else if (is_cpp) {
                write_stdout(`cpp (GCC) 14.2.0 (LLVM 16.0.0 Clang backend for Jazu Desktop)\nCopyright (C) 2024 Free Software Foundation, Inc.\nThis is free software; see the source for copying conditions.  There is NO\nwarranty; not even for MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.\n\n`)
            } else {
                write_stdout(`gcc (GCC) 14.2.0 (LLVM 16.0.0 Clang backend for Jazu Desktop)\nCopyright (C) 2024 Free Software Foundation, Inc.\nThis is free software; see the source for copying conditions.  There is NO\nwarranty; not even for MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.\n\n`)
            }
            send({ exit: 0 })
            return
        }

        if (show_verbose && input_files.length === 0) {
            if (is_clang) {
                write_stderr(`clang version 16.0.0\nTarget: wasm32-unknown-wasi\nThread model: posix\n`)
            } else {
                write_stdout(`Using built-in specs.\nCOLLECT_GCC=${prog}\nCOLLECT_LTO_WRAPPER=/usr/libexec/gcc/wasm32-wasi/14.2.0/lto-wrapper\nTarget: wasm32-unknown-wasi\nConfigured with: ../llvm-project-16.0.0/clang -v --target=wasm32-unknown-wasi\nThread model: posix\ngcc version 14.2.0 (LLVM 16.0.0 Clang backend for Jazu Desktop)\n`)
            }
            send({ exit: 0 })
            return
        }

        if (input_files.length === 0) {
            write_stderr(`${prog}: fatal error: no input files\ncompilation terminated.\n`)
            send({ exit: 1 })
            return
        }

        if (show_verbose) {
            write_stdout(`Using built-in specs.\nCOLLECT_GCC=${prog}\nCOLLECT_LTO_WRAPPER=/usr/libexec/gcc/wasm32-wasi/14.2.0/lto-wrapper\nTarget: wasm32-unknown-wasi\nConfigured with: ../llvm-project-16.0.0/clang -v --target=wasm32-unknown-wasi\nThread model: posix\ngcc version 14.2.0 (LLVM 16.0.0 Clang backend for Jazu Desktop)\n`)
        }

        // Determine destination output file
        let target_out = outfile
        if (!target_out) {
            if (mode === "obj") {
                const base = input_files[0].split("/").pop() || "a"
                target_out = base.replace(/\.[^.]+$/, "") + ".o"
            } else if (mode === "asm") {
                const base = input_files[0].split("/").pop() || "a"
                target_out = base.replace(/\.[^.]+$/, "") + ".s"
            } else {
                target_out = "a.out"
            }
        }

        // Read source files from Virtual File System
        const sources: { name: string, content: Uint8Array }[] = []
        for (const rel of input_files) {
            const abs = resolve_path(rel)
            const bytes = read_vfs_bytes(abs)
            if (!bytes) {
                write_stderr(`${prog}: error: ${rel}: No such file or directory\n`)
                send({ exit: 1 })
                return
            }
            const guest_name = rel.includes("/") ? rel.split("/").pop()! : rel
            sources.push({ name: guest_name, content: bytes })
        }

        // Read any user include directories from VFS
        const includes: Record<string, Uint8Array> = {}
        for (const inc of inc_paths) {
            const abs_inc = resolve_path(inc)
            try {
                const entries = call("readdir", { path: abs_inc }) as string[]
                if (Array.isArray(entries)) {
                    for (const entry of entries) {
                        const file_bytes = read_vfs_bytes(`${abs_inc}/${entry}`)
                        if (file_bytes) {
                            includes[`${inc}/${entry}`] = file_bytes
                        }
                    }
                }
            } catch {}
        }

        const out_basename = target_out.includes("/") ? target_out.split("/").pop()! : target_out

        // Compile with LLVM Clang toolchain
        const res = await compile_with_llvm({
            sources,
            includes,
            outputName: out_basename,
            args: extra_flags,
            isCxx: is_cxx
        })

        if (res.exitCode !== 0) {
            if (res.stderr) write_stderr(res.stderr)
            if (res.stdout) write_stdout(res.stdout)
            send({ exit: res.exitCode || 1 })
            return
        }

        if (res.outputBytes) {
            const abs_out = resolve_path(target_out)
            write_vfs_bytes(abs_out, res.outputBytes)
        }

        if (res.stderr) write_stderr(res.stderr)
        if (res.stdout) write_stdout(res.stdout)
        send({ exit: 0 })
    } catch (error) {
        write_stderr(`fatal error: ${error instanceof Error ? error.message : String(error)}\n`)
        send({ exit: 1 })
    }
}

const scope = globalThis as unknown as { postMessage(value: unknown): void, onmessage: ((event: MessageEvent<worker_start>) => void) | null }
if (typeof scope.postMessage === "function") {
    scope.onmessage = event => { void run_worker(event.data, value => scope.postMessage(value)) }
}
