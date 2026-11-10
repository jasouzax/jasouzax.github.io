// Process windows use xterm's VT parser and raw input. The kernel owns PIDs;
// the lazy registry supplies compiled programs and their shared filesystem.

import type { desk_window } from "./desk.ts"
import { state, text, window_hooks, refresh_tab, working_directory } from "./desk.ts"
import { process_hooks, uri_handlers, render_window, fail_window } from "./desk_view.ts"
import { kernel, kill, interrupt, make_stream, start_process } from "./kernel.ts"
import type { proc } from "./kernel.ts"
import type { program } from "./proc_types.ts"
import { make_fs } from "./desk_vfs.ts"
import { mount_executables } from "./desk_fs.ts"
import { host_programs, probe_host } from "./desk_host.ts"
import { Terminal } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"

export const pid_mime = "application/x-pid"

// the page script's data-desk-shell attribute is the address of the shell bundle; document.currentScript is only set while it first runs
const shell_url = document.currentScript?.getAttribute("data-desk-shell") ?? (typeof document !== "undefined" ? (document.querySelector("script[data-desk-shell]") as HTMLScriptElement | null)?.getAttribute("data-desk-shell") ?? "" : "")

type shell_window = Window & { jazu_desk_shell?: { programs: Record<string, program>, ready: Promise<void> } }

let runtime: Promise<Record<string, program>> | null = null

function load_runtime(): Promise<Record<string, program>> {
    const loaded = (window as shell_window).jazu_desk_shell
    if (loaded) return loaded.ready.then(() => loaded.programs)
    runtime ??= new Promise((done, fail) => {
        if (!shell_url) {
            fail(new Error("the shell runtime is not part of this page"))
            return
        }
        const script = document.createElement("script")
        script.src = shell_url
        script.onload = () => {
            const api = (window as shell_window).jazu_desk_shell
            if (api) api.ready.then(() => done(api.programs), fail)
            else fail(new Error("the shell runtime did not start"))
        }
        script.onerror = () => {
            runtime = null
            fail(new Error("the shell runtime could not be loaded"))
        }
        document.head.append(script)
    })
    return runtime
}

let program_names: string[] = []

// ---- windows and processes ----------------------------------------------------------------------------------------------------------

const viewers = new Map<number, Set<desk_window>>()
const cleanups = new WeakMap<desk_window, () => void>()

function attach(item: desk_window, pid: number): void {
    detach(item)
    item.pid = pid
    item.error = ""
    item.file = null
    item.name = `pid:${pid}`
    item.path = `pid:${pid}`
    item.mime = pid_mime
    item.candidates = [pid_mime]
    item.icon = state.data?.mimes.find(info => info.mime === pid_mime)?.icon ?? state.data?.file_icon ?? ""
    item.mode = "view"
    item.save = null
    let set = viewers.get(pid)
    if (!set) viewers.set(pid, (set = new Set()))
    set.add(item)
    render_window(item)
}

// a window lets go of its process; a process nobody shows any more ends
function detach(item: desk_window): void {
    cleanups.get(item)?.()
    cleanups.delete(item)
    const pid = item.pid
    if (pid === null) return
    item.pid = null
    const set = viewers.get(pid)
    set?.delete(item)
    if (set && set.size === 0) {
        viewers.delete(pid)
        kill(pid, 129)
        kernel.table.delete(pid)
    }
}

function new_shell(): proc {
    const stdin = make_stream()
    kernel.terminals.add(stdin)
    return start_process(["sh", "-i", "+m"], { root: true, stdin, cwd: working_directory(), env: { HOME: "/home/user", USER: "user", LOGNAME: "user", HOSTNAME: "jasouza", PATH: "/bin", SHELL: "/bin/sh", TERM: "xterm-256color", PS1: "\\[\\033[1;32m\\]user@jasouza\\[\\033[0m\\]:\\[\\033[1;34m\\]$PWD\\[\\033[0m\\]$ " }, interactive: true })
}

// a real shell on the device through the extension bridge; the process only relays bytes, the shell itself runs on the machine
function new_host_shell(): proc {
    const stdin = make_stream()
    kernel.terminals.add(stdin)
    return start_process(["host_sh"], { root: true, stdin, cwd: "/", env: {}, interactive: true })
}

async function open_pid(item: desk_window, uri: string): Promise<boolean> {
    if (/^(host:|pid:\/\/host)$/i.test(uri.trim())) {
        attach(item, new_host_shell().pid)
        return true
    }
    const match = /^pid:(\d*)$/i.exec(uri.trim()) ?? (uri.trim() === "pid://sh" ? [uri, ""] : null)
    if (!match) return false
    if (match[1] === "") {
        attach(item, new_shell().pid)
        return true
    }
    const found = kernel.table.get(Number(match[1]))
    if (!found) {
        fail_window(item, uri, `${text("process_gone")} ${match[1]}`)
        return true
    }
    attach(item, found.pid)
    return true
}

// ---- the terminal -------------------------------------------------------------------------------------------------------------------

function note_body(message: string): HTMLElement {
    const note = document.createElement("div")
    note.className = "desk_wbox_body_none"
    note.setAttribute("role", "status")
    const line = document.createElement("p")
    line.textContent = message
    note.append(line)
    return note
}

function terminal_body(item: desk_window): HTMLElement {
    cleanups.get(item)?.()
    cleanups.delete(item)
    if (item.mode !== "view") return note_body(text("unsupported_edit"))
    const proc = item.pid === null ? undefined : kernel.table.get(item.pid)
    if (!proc) return note_body(text("process_gone"))
    if (!document.querySelector("link[data-terminal-css]")) {
        const css = document.createElement("link")
        css.rel = "stylesheet"; css.href = "/assets/terminal/xterm-5.5.0.css"; css.dataset.terminalCss = "1"
        document.head.append(css)
    }
    const box = document.createElement("div")
    box.className = "desk_wbox_body_term"
    box.style.cssText = "position:relative;display:block;min-height:120px;height:100%;overflow:hidden;padding:8px"
    const terminal = new Terminal({ allowTransparency: true, cursorBlink: true, convertEol: proc.argv[0] !== "host_sh", screenReaderMode: true, fontSize: 14, scrollback: 4000 })
    const sync_theme = (): void => {
        const style = getComputedStyle(item.el)
        const foreground = style.getPropertyValue("--terminal-text").trim() || style.color
        terminal.options.theme = {
            background: "#00000000", foreground,
            cursor: style.getPropertyValue("--terminal-cursor").trim() || foreground,
            cursorAccent: style.getPropertyValue("--terminal-cursor-text").trim() || style.getPropertyValue("--panel").trim(),
        }
    }
    const theme_observer = new MutationObserver(sync_theme)
    theme_observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-mode", "data-theme"] })
    const scheme = matchMedia("(prefers-color-scheme: dark)")
    scheme.addEventListener("change", sync_theme)
    document.addEventListener("change", sync_theme)
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    const append = (chunk: string): void => { terminal.write(chunk) }
    const finished = (): void => { terminal.writeln("\r\n[process exited " + (proc.code ?? 0) + "]"); terminal.options.disableStdin = true }
    const input = terminal.onData(data => {
        if (!proc.running) return
        if (data === "\x03") { interrupt(proc); return }
        proc.stdin.write(data)
    })
    const sized = terminal.onResize(({ cols, rows }) => { proc.terminal_size = [cols, rows]; proc.resize?.(cols, rows) })
    const observer = new ResizeObserver(() => { if (box.isConnected) { try { fit.fit() } catch {} } })
    queueMicrotask(() => {
        if (!box.isConnected) return
        terminal.open(box)
        sync_theme()
        observer.observe(box)
        fit.fit()
        proc.terminal_size = [terminal.cols, terminal.rows]
        proc.resize?.(terminal.cols, terminal.rows)
        for (const entry of proc.screen) append(entry.text)
        proc.listeners.add(append)
        proc.exit_listeners.add(finished)
        if (!proc.running) finished()
        terminal.focus()
    })
    cleanups.set(item, () => {
        observer.disconnect(); input.dispose(); sized.dispose()
        theme_observer.disconnect()
        scheme.removeEventListener("change", sync_theme)
        document.removeEventListener("change", sync_theme)
        proc.listeners.delete(append); proc.exit_listeners.delete(finished)
        terminal.dispose()
    })
    return box
}

// ---- wiring -------------------------------------------------------------------------------------------------------------------------

export function init_proc(): void {
    const programs = async () => {
        const programs = await load_runtime()
        const names = Object.keys(programs).sort()
        if (names.join("\0") !== program_names.join("\0")) {
            program_names = names
            await mount_executables(program_names)
        }
        return { ...programs, ...host_programs }
    }
    kernel.hooks = {
        programs,
        fs: uid => make_fs(() => program_names, uid),
    }
    document.addEventListener("jazu:fs:init", () => { void programs().catch(error => console.error(error)); probe_host() })
    process_hooks.body = terminal_body
    process_hooks.release = detach
    process_hooks.release_body = item => { cleanups.get(item)?.(); cleanups.delete(item) }
    uri_handlers.push(open_pid)
    const previous = window_hooks.closed
    window_hooks.closed = item => {
        previous(item)
        detach(item)
    }
    // a process shown in a window that is still there keeps running when the page changes; leaving the desk page ends them
    document.addEventListener("jazu:page", () => {
        if (!document.querySelector(".desk[data-runtime]")) {
            for (const item of kernel.table.values()) if (item.running) kill(item.pid, 129)
            kernel.table.clear()
            viewers.clear()
        }
    })
    void refresh_tab
}
