/*
 * Real pseudo-terminal sessions (the same design as extension/host/pty.ts, kept here so server/ stays a self-contained sub codebase).
 *
 * Entities
 *   open_pty      starts one interactive shell on a pty and reports its output and exit
 *   Pty_Session   what a caller may do with it: write, resize, pause/resume output, close
 *   pick_backend  "python" (resize works) or "script" (util-linux fallback, fixed size)
 *
 * Limits
 *   Spawns exactly one fixed program per session (the account's shell): no command string ever comes from the page.
 *   Output is raw bytes; framing and base64 belong to pty_channel.ts.
 */
import { spawn } from "child_process"
import type { ChildProcess } from "child_process"
import { accessSync, constants } from "fs"
import { delimiter, join } from "path"

export type Pty_Backend = "python" | "script"
export type Pty_Options = { cols: number, rows: number, cwd: string, shell: string, shell_args?: string[], env: NodeJS.ProcessEnv, backend: Pty_Backend, shim: string }
export type Pty_Events = { on_data: (chunk: Buffer) => void, on_exit: (code: number) => void }
export type Pty_Session = { write: (data: Buffer) => void, resize: (cols: number, rows: number) => void, pause: () => void, resume: () => void, close: () => void }

function on_path(program: string): boolean {
    return (process.env.PATH ?? "").split(delimiter).some(directory => {
        try { accessSync(join(directory, program), constants.X_OK); return true } catch { return false }
    })
}

export function pick_backend(): Pty_Backend {
    if (on_path("python3")) return "python"
    if (on_path("script")) return "script"
    throw new Error("no pty backend: install python3 (preferred) or util-linux's script")
}

const quote = (word: string) => `'${word.replaceAll("'", "'\\''")}'`

function launch(options: Pty_Options): ChildProcess {
    const spawn_options = { cwd: options.cwd, env: options.env, stdio: ["pipe", "pipe", "pipe", "pipe"] as ["pipe", "pipe", "pipe", "pipe"] }
    if (options.backend === "python") return spawn("python3", [options.shim, String(options.cols), String(options.rows), options.shell, ...(options.shell_args ?? ["-i"])], spawn_options)
    // script cannot be resized later; the size is applied once, before the shell takes over
    return spawn("script", ["-qefc", `stty cols ${options.cols} rows ${options.rows} 2>/dev/null; exec ${[options.shell, ...(options.shell_args ?? ["-i"])].map(quote).join(" ")}`, "/dev/null"], spawn_options)
}

export function open_pty(options: Pty_Options, events: Pty_Events): Pty_Session {
    const child = launch(options)
    let ended = false
    const finish = (code: number): void => {
        if (ended) return
        ended = true
        events.on_exit(code)
    }
    child.stdout!.on("data", (chunk: Buffer) => events.on_data(chunk))
    child.stderr!.on("data", (chunk: Buffer) => process.stderr.write(`[pty] ${chunk}`))
    child.stdin!.on("error", () => undefined)
    child.stdio[3]?.on("error", () => undefined)
    child.on("error", error => { process.stderr.write(`[pty] ${error.message}\n`); finish(127) })
    // "close" (not "exit") so every byte the shell printed has been read first
    child.on("close", (code, signal) => finish(code ?? (signal ? 129 : 1)))
    return {
        write: data => { if (!ended) child.stdin!.write(data) },
        resize: (cols, rows) => { if (!ended && options.backend === "python") (child.stdio[3] as NodeJS.WritableStream).write(`R ${rows} ${cols}\n`) },
        pause: () => child.stdout!.pause(),
        resume: () => child.stdout!.resume(),
        close: () => { if (!ended) child.kill("SIGHUP") },
    }
}
