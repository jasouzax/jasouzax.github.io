// The contract between the desk's kernel (client_desk_proc.ts, in the page bundle) and the shell runtime (client_desk_shell.ts, a lazily
// loaded bundle). Only types live here, so neither bundle copies the other's code.

// A text stream: what one process writes is what another (or a window) reads. Reading waits for data; null is end of file.
export type text_stream = {
    write(data: string): void
    // no more data: readers get what is left, then null
    end(): void
    read(): Promise<string | null>
    // a terminal's Ctrl+D: the reader that is waiting gets null once, the stream goes on
    eof(): void
    ended: boolean
    available?(): boolean
}

export type stat_info = { kind: "file" | "dir", size: number, writable: boolean, uid?: number, gid?: number }

// The file system a process sees: one tree with the desk's files, plus /bin and /proc made by the kernel. Paths are absolute.
export type fs_api = {
    stat(path: string): Promise<stat_info | null>
    list(path: string): Promise<{ name: string, kind: "file" | "dir" }[]>
    read(path: string): Promise<string>
    write(path: string, data: string, append?: boolean): Promise<void>
    mkdir(path: string): Promise<void>
    remove(path: string, recursive?: boolean): Promise<void>
    rename(from: string, to: string): Promise<void>
    read_bytes?(path: string): Promise<Uint8Array>
    write_bytes?(path: string, data: Uint8Array): Promise<void>
    chown?(path: string, uid: number, gid: number): Promise<void>
}

export type proc_info = { pid: number, ppid: number, argv: string[], running: boolean, code: number | null, uid?: number, gid?: number }

export type spawn_options = {
    uid: number
    gid: number
    cwd: string
    env: Record<string, string>
    stdin: text_stream
    stdout: text_stream
    stderr: text_stream
    background?: boolean
    wasm?: { descriptors: import("./wasm_protocol.ts").descriptor[], snapshot?: import("./wasm_protocol.ts").fork_state }
}

// what a running program gets
export type proc_api = {
    uid: number
    gid: number
    pid: number
    ppid: number
    argv: string[]
    cwd: string
    env: Record<string, string>
    stdin: text_stream
    stdout: text_stream
    stderr: text_stream
    fs: fs_api
    // true when stdin is a person typing (a window), not a pipe or a file
    interactive: boolean
    // aborted by kill (and by Ctrl+C when the program has not asked to handle it itself)
    signal: AbortSignal
    // a program that handles Ctrl+C itself (an interactive shell) registers here; without a handler Ctrl+C kills it
    on_interrupt(handler: () => void): void
    // starts a program as a child process with its own pid; the answer is its exit code
    spawn(argv: string[], options: Partial<spawn_options>): { pid: number, done: Promise<number> }
    // a stream the kernel connects (a pipe)
    pipe(): text_stream
    list_procs(): proc_info[]
    kill(pid: number, code?: number): boolean
    // every program name the runtime has (for `help`, `which`, completion)
    commands: string[]
    wasm?: spawn_options["wasm"]
    resize?: (cols: number, rows: number) => void
}

// a program of the shell runtime: gets its process and answers its exit code
export type program = (proc: proc_api) => Promise<number>

export type shell_runtime = {
    // every program by name (sh and the utilities)
    programs: Record<string, program>
}
