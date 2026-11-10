import type { fs_api, proc_api, text_stream } from "./proc_types.ts"

export interface LLVMCompileSource {
    name: string
    content: string | Uint8Array
}

export interface LLVMCompileRequest {
    sources: LLVMCompileSource[]
    includes?: Record<string, string | Uint8Array>
    outputName?: string
    args?: string[]
    isCxx?: boolean
    onProgress?: (progress: any) => void
}

export interface LLVMCompileResponse {
    exitCode: number
    stdout: string
    stderr: string
    outputBytes?: Uint8Array
}

let wasmerInstance: any = null
let clangPackagePromise: Promise<any> | null = null

export async function getWasmer(): Promise<any> {
    if (!wasmerInstance) {
        let Wasmer: any
        if (typeof process !== "undefined" && process.versions?.node) {
            const mod = await import("@wasmer/sdk")
            Wasmer = mod.Wasmer
        } else {
            let mod: any = null
            if (typeof location !== "undefined") {
                const base = (location.origin && location.origin !== "null") ? location.origin : location.href
                const localUrl = new URL("/assets/wasmer/dist/index.js", base).href
                try {
                    mod = await import(/* @vite-ignore */ localUrl)
                } catch (err: any) {
                    console.error("Failed to load local Wasmer SDK:", err)
                    throw new Error(`Failed to load local Wasmer SDK from ${localUrl}: ${err?.message || err}`)
                }
            } else {
                throw new Error("Cannot locate Wasmer SDK: location is undefined in worker context")
            }
            Wasmer = mod.Wasmer
        }
        wasmerInstance = new Wasmer()
    }
    return wasmerInstance
}

export async function getClangPackage(onProgress?: (p: any) => void): Promise<any> {
    if (!clangPackagePromise) {
        clangPackagePromise = (async () => {
            const wasmer = await getWasmer()
            // 1. Try local WEBC package first for offline compilation
            try {
                if (typeof location !== "undefined") {
                    const base = (location.origin && location.origin !== "null") ? location.origin : location.href
                    const localWebcUrl = new URL("/assets/wasm/clang.webc", base).href
                    const response = await fetch(localWebcUrl)
                    if (response.ok) {
                        const buffer = await response.arrayBuffer()
                        return await wasmer.packages.load(new Uint8Array(buffer), onProgress ? { onProgress } : undefined)
                    }
                }
            } catch {}
            // 2. Fall back to registry or local package cache
            return wasmer.packages.load("clang/clang", onProgress ? { onProgress } : undefined)
        })()
    }
    return clangPackagePromise
}

export async function compile_with_llvm(req: LLVMCompileRequest): Promise<LLVMCompileResponse> {
    const wasmer = await getWasmer()
    const pkg = await getClangPackage(req.onProgress)

    const files: Record<string, string | Uint8Array> = {}
    const mappedSources: string[] = []

    for (const src of req.sources) {
        const guestPath = `/workspace/${src.name.replace(/^\/+/, "")}`
        files[guestPath] = src.content
        mappedSources.push(guestPath)
    }

    if (req.includes) {
        for (const [incPath, content] of Object.entries(req.includes)) {
            const guestPath = `/workspace/${incPath.replace(/^\/+/, "")}`
            files[guestPath] = content
        }
    }

    const outName = req.outputName ?? "a.out.wasm"
    const guestOut = `/workspace/${outName.replace(/^\/+/, "")}`

    const clangArgs: string[] = []
    if (req.isCxx) {
        clangArgs.push("-x", "c++")
    }

    if (req.args) {
        for (const arg of req.args) {
            if (arg.startsWith("-I") && arg.length > 2) {
                clangArgs.push("-I/workspace/" + arg.slice(2).replace(/^\/+/, ""))
            } else {
                clangArgs.push(arg)
            }
        }
    }

    clangArgs.push(...mappedSources, "-o", guestOut)

    const sb = await wasmer.sandboxes.create({
        packages: [pkg],
        files
    })

    try {
        const cmd = sb.command("clang", clangArgs)
        const res = await cmd.run({ check: false })
        const decoder = new TextDecoder()
        const stdout = decoder.decode(res.stdout.bytes)
        const stderr = decoder.decode(res.stderr.bytes)

        let outputBytes: Uint8Array | undefined
        if (res.exitCode === 0) {
            try {
                outputBytes = await sb.fs.readFile(guestOut)
            } catch {}
        }

        return {
            exitCode: res.exitCode,
            stdout,
            stderr,
            outputBytes
        }
    } finally {
        await sb.close().catch(() => {})
    }
}

export async function run_wasm_instance(options: {
    wasmBytes: Uint8Array
    argv?: string[]
    env?: Record<string, string>
    stdin?: text_stream | string | AsyncIterable<Uint8Array | string>
    onStdout?: (text: string) => void
    onStderr?: (text: string) => void
}): Promise<number> {
    const wasmer = await getWasmer()
    const appPkg = await wasmer.packages.load(options.wasmBytes)
    const appSb = await wasmer.sandboxes.create({
        packages: [appPkg],
        env: options.env
    })

    try {
        const cmdName = (Array.isArray(appPkg.commands) && appPkg.commands[0]) ? appPkg.commands[0] : (appPkg.entrypoint || "main")
        const proc = await appSb.command(cmdName, options.argv ?? []).spawn({
            stdin: "pipe",
            stdout: "pipe",
            stderr: "pipe"
        })

        const decoder = new TextDecoder()
        const stdoutDone = (async () => {
            if (!proc.stdout) return
            try {
                for await (const chunk of proc.stdout) {
                    options.onStdout?.(decoder.decode(chunk))
                }
            } catch {}
        })()

        const stderrDone = (async () => {
            if (!proc.stderr) return
            try {
                for await (const chunk of proc.stderr) {
                    options.onStderr?.(decoder.decode(chunk))
                }
            } catch {}
        })()

        const stdinDone = (async () => {
            if (!proc.stdin) return
            try {
                if (typeof options.stdin === "string") {
                    if (options.stdin.length > 0) await proc.stdin.write(options.stdin)
                    await proc.stdin.close()
                } else if (options.stdin && typeof (options.stdin as text_stream).read === "function") {
                    const stream = options.stdin as text_stream
                    while (true) {
                        const chunk = await stream.read()
                        if (chunk === null) break
                        if (chunk.length > 0) await proc.stdin.write(chunk)
                    }
                    await proc.stdin.close()
                } else if (options.stdin && Symbol.asyncIterator in (options.stdin as any)) {
                    for await (const chunk of (options.stdin as any)) {
                        await proc.stdin.write(chunk)
                    }
                    await proc.stdin.close()
                } else {
                    await proc.stdin.close()
                }
            } catch {}
        })()

        const result = await proc.wait({ check: false })
        await Promise.all([stdoutDone, stderrDone, stdinDone])
        return result.exitCode
    } finally {
        await appSb.close().catch(() => {})
    }
}

export async function run_wasm_runner(p: proc_api): Promise<number> {
    if (p.argv.length < 2) {
        p.stderr.write("wasm-runner: missing WebAssembly binary path\n")
        return 1
    }
    const rawPath = p.argv[1]
    const resolvedPath = rawPath.startsWith("/") ? rawPath : (p.cwd.replace(/\/+$/, "") + "/" + rawPath)
    if (!p.fs.read_bytes) {
        p.stderr.write("wasm-runner: binary filesystem API unavailable\n")
        return 1
    }
    let bytes: Uint8Array
    try {
        bytes = await p.fs.read_bytes(resolvedPath)
    } catch (err) {
        p.stderr.write(`wasm-runner: cannot open '${resolvedPath}': ${err instanceof Error ? err.message : String(err)}\n`)
        return 127
    }
    if (bytes.length < 4 || bytes[0] !== 0x00 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d) {
        p.stderr.write(`wasm-runner: '${resolvedPath}' is not a valid WebAssembly binary\n`)
        return 126
    }
    const appArgv = [resolvedPath.split("/").pop()!, ...p.argv.slice(2)]
    return await run_wasm_instance({
        wasmBytes: bytes,
        argv: appArgv,
        env: p.env,
        stdin: p.stdin,
        onStdout: text => p.stdout.write(text),
        onStderr: text => p.stderr.write(text)
    })
}

export function cleanup_llvm(): void {
    if (typeof process !== "undefined" && typeof (process as any)._getActiveHandles === "function") {
        for (const h of (process as any)._getActiveHandles()) {
            h.unref?.()
        }
    }
}

