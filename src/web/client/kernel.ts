// The process table of the desk. A process is a program (see client_proc_types.ts) with a pid and three text streams. This file has no DOM:
// the windows that show a process (client_desk_proc.ts) and the file system (client_desk_vfs.ts) are plugged in from outside.

import type { fs_api, program, proc_api, proc_info, spawn_options, text_stream } from "./proc_types.ts"

// ---- streams ----------------------------------------------------------------------------------------------------------------------

const EOF_MARK = Symbol("eof")

export function make_stream(): text_stream {
    const queue: (string | typeof EOF_MARK)[] = []
    const waiting: ((value: string | null) => void)[] = []
    const stream: text_stream = {
        ended: false,
        write(data) {
            if (stream.ended || data === "") return
            const reader = waiting.shift()
            if (reader) reader(data)
            else queue.push(data)
        },
        end() {
            if (stream.ended) return
            stream.ended = true
            for (const reader of waiting.splice(0)) reader(null)
        },
        eof() {
            const reader = waiting.shift()
            if (reader) reader(null)
            else queue.push(EOF_MARK)
        },
        read() {
            const next = queue.shift()
            if (next !== undefined) return Promise.resolve(next === EOF_MARK ? null : next)
            if (stream.ended) return Promise.resolve(null)
            return new Promise(done => waiting.push(done))
        },
    }
    return stream
}

// a stream that only hands what is written to a function (a window's screen, a file being written); reading it gives end of file
export function make_sink(on_write: (data: string) => void, on_end: () => void = () => undefined): text_stream {
    const stream: text_stream = {
        ended: false,
        write(data) {
            if (!stream.ended && data !== "") on_write(data)
        },
        end() {
            if (stream.ended) return
            stream.ended = true
            on_end()
        },
        eof() {},
        read: () => Promise.resolve(null),
    }
    return stream
}

export function stream_of(text: string): text_stream {
    const stream = make_stream()
    stream.write(text)
    stream.end()
    return stream
}

// ---- processes --------------------------------------------------------------------------------------------------------------------

export type proc = {
    pid: number
    ppid: number
    argv: string[]
    cwd: string
    env: Record<string, string>
    stdin: text_stream
    stdout: text_stream
    stderr: text_stream
    running: boolean
    code: number | null
    abort: AbortController
    interrupt: (() => void)[]
    children: Set<number>
    done: Promise<number>
    // a root process (made by a window) stays in the table after it exits, until its window lets go of it
    root: boolean
    interactive: boolean
    // what the window shows: every write to stdout (false) and stderr (true), in order
    screen: { text: string, err: boolean }[]
    listeners: Set<(text: string, err: boolean) => void>
    exit_listeners: Set<() => void>
    resize?: (cols: number, rows: number) => void
    terminal_size?: [number, number]
    background?: boolean
}

export type kernel_hooks = {
    // the programs of the shell runtime (loaded the first time a process is made)
    programs: () => Promise<Record<string, program>>
    fs: () => fs_api
}

const screen_limit = 400_000

export const kernel = {
    table: new Map<number, proc>(),
    next_pid: 1,
    hooks: null as kernel_hooks | null,
    terminals: new WeakSet<text_stream>(),
}

export function reset_kernel(): void {
    for (const item of kernel.table.values()) if (item.running) item.abort.abort()
    kernel.table.clear()
    kernel.next_pid = 1
}

export function list_procs(): proc_info[] {
    return [...kernel.table.values()].map(item => ({ pid: item.pid, ppid: item.ppid, argv: item.argv, running: item.running, code: item.code }))
}

function interrupted_code(): number {
    return 130
}

export function kill(pid: number, code: number = 143): boolean {
    const item = kernel.table.get(pid)
    if (!item || !item.running) return false
    // a process takes its children with it
    for (const child of item.children) kill(child, code)
    item.code = code
    item.abort.abort()
    finish(item, code)
    return true
}

function finish(item: proc, code: number): void {
    if (!item.running) return
    item.running = false
    item.code = item.code ?? code
    item.abort.abort()
    const parent = kernel.table.get(item.ppid)
    parent?.children.delete(item.pid)
    if (!item.root) kernel.table.delete(item.pid)
    for (const listener of [...item.exit_listeners]) listener()
}

function leaves_of(item: proc): proc[] {
    const running = [...item.children].map(pid => kernel.table.get(pid)).filter((child): child is proc => !!child && child.running && !child.background)
    return running.length === 0 ? [item] : running.flatMap(leaves_of)
}

// Ctrl+C in a window: goes to what runs in front (the last processes of the tree), and a program that handles it itself (the shell) is
// not killed but told.
export function interrupt(root: proc): void {
    for (const leaf of leaves_of(root)) {
        if (leaf.interrupt.length > 0) for (const handler of [...leaf.interrupt]) handler()
        else kill(leaf.pid, interrupted_code())
    }
}

export function start_process(argv: string[], options: Partial<spawn_options> & { ppid?: number, root?: boolean, interactive?: boolean }): proc {
    const hooks = kernel.hooks!
    const parent = options.ppid ? kernel.table.get(options.ppid) : undefined
    const pid = kernel.next_pid++
    const stdin = options.stdin ?? stream_of("")
    const item: proc = {
        pid, ppid: options.ppid ?? 0, argv, cwd: options.cwd ?? parent?.cwd ?? "/", env: { ...(options.env ?? parent?.env ?? {}) },
        stdin, stdout: options.stdout ?? make_sink(() => undefined), stderr: options.stderr ?? options.stdout ?? make_sink(() => undefined),
        running: true, code: null, abort: new AbortController(), interrupt: [], children: new Set(), done: null as unknown as Promise<number>,
        root: options.root ?? false, interactive: options.interactive ?? kernel.terminals.has(stdin), screen: [], listeners: new Set(), exit_listeners: new Set(),
        background: options.background,
    }
    // a root process writes to its window: every write is kept (the window may open later or twice) and shown to whoever listens
    if (item.root && !options.stdout) {
        let kept = 0
        const emit = (text: string, err: boolean): void => {
            item.screen.push({ text, err })
            kept += text.length
            while (kept > screen_limit && item.screen.length > 1) kept -= item.screen.shift()!.text.length
            for (const listener of [...item.listeners]) listener(text, err)
        }
        item.stdout = make_sink(text => emit(text, false))
        item.stderr = make_sink(text => emit(text, true))
    }
    kernel.table.set(pid, item)
    parent?.children.add(pid)
    const aborted = new Promise<number>(done => item.abort.signal.addEventListener("abort", () => done(item.code ?? interrupted_code())))
    const api: proc_api = {
        pid, ppid: item.ppid, argv, cwd: item.cwd, env: item.env, stdin: item.stdin, stdout: item.stdout, stderr: item.stderr, fs: hooks.fs(), interactive: item.interactive,
        wasm: options.wasm,
        signal: item.abort.signal,
        on_interrupt: handler => { item.interrupt.push(handler) },
        spawn: (child_argv, child_options) => {
            const child = start_process(child_argv, { cwd: item.cwd, env: item.env, stdin: item.stdin, stdout: item.stdout, stderr: item.stderr, ...child_options, ppid: pid })
            return { pid: child.pid, done: child.done }
        },
        pipe: make_stream,
        list_procs, kill,
        commands: [],
    }
    // The host updates cwd/argv after chdir/exec and forwards PTY dimensions.
    Object.defineProperty(api, "cwd", { get: () => item.cwd, set: value => { item.cwd = value } })
    Object.defineProperty(api, "argv", { get: () => item.argv, set: value => { item.argv = value } })
    Object.defineProperty(api, "env", { get: () => item.env, set: value => { item.env = value } })
    Object.defineProperty(api, "resize", { get: () => item.resize, set: value => { item.resize = value; if (item.terminal_size) value?.(...item.terminal_size) } })
    const run = (async (): Promise<number> => {
        try {
            const programs = await hooks.programs()
            api.commands = Object.keys(programs).sort()
            const main = programs[argv[0]]
            if (!main) {
                item.stderr.write(`${argv[0]}: command not found\n`)
                return 127
            }
            return await main(api)
        } catch (error) {
            item.stderr.write(`${argv[0]}: ${error instanceof Error ? error.message : String(error)}\n`)
            return 1
        }
    })()
    item.done = Promise.race([run, aborted]).then(code => {
        finish(item, code)
        return item.code ?? code
    })
    return item
}
