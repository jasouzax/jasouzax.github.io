// Processes on the desk. A process has the uri `pid:{id}`; typing `pid:` (no id) in a window's source starts a new one, whose program is the
// shell (`sh`), and the window shows it as a terminal: what the process writes to stdout and stderr, and a line to type into its stdin. `pid:3`
// shows an existing one. The programs live in a separate script (client_desk_shell.ts, loaded the first time) and the process table in
// client_kernel.ts; this file is the part in the page: the window, the loader and the file system the processes see.

import type { desk_window } from "./desk.ts"
import { state, text, window_hooks, refresh_tab } from "./desk.ts"
import { process_hooks, uri_handlers, render_window } from "./desk_view.ts"
import { kernel, kill, interrupt, make_stream, start_process } from "./kernel.ts"
import type { proc } from "./kernel.ts"
import type { program } from "./proc_types.ts"
import { make_fs } from "./desk_vfs.ts"

export const pid_mime = "application/x-pid"

// the page script's data-desk-shell attribute is the address of the shell bundle; document.currentScript is only set while it first runs
const shell_url = document.currentScript?.getAttribute("data-desk-shell") ?? ""

type shell_window = Window & { jazu_desk_shell?: { programs: Record<string, program> } }

let runtime: Promise<Record<string, program>> | null = null

function load_runtime(): Promise<Record<string, program>> {
    const loaded = (window as shell_window).jazu_desk_shell
    if (loaded) return Promise.resolve(loaded.programs)
    runtime ??= new Promise((done, fail) => {
        if (!shell_url) {
            fail(new Error("the shell runtime is not part of this page"))
            return
        }
        const script = document.createElement("script")
        script.src = shell_url
        script.onload = () => {
            const api = (window as shell_window).jazu_desk_shell
            if (api) done(api.programs)
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
    return start_process(["sh"], { root: true, stdin, cwd: "/home/user", env: { HOME: "/home/user", USER: "user" }, interactive: true })
}

async function open_pid(item: desk_window, uri: string): Promise<boolean> {
    const match = /^pid:(\d*)$/i.exec(uri.trim())
    if (!match) return false
    if (match[1] === "") {
        attach(item, new_shell().pid)
        return true
    }
    const found = kernel.table.get(Number(match[1]))
    if (!found || !found.root) {
        const path = item.el.querySelector<HTMLInputElement>(".desk_wbox_head_path")
        if (path) path.setCustomValidity(`${text("process_gone")} ${match[1]}`)
        path?.reportValidity()
        path?.setCustomValidity("")
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
    // only the view works on a process: text and edit have no file to show or change
    if (item.mode !== "view") return note_body(`${text(item.mode === "edit" ? "unsupported_edit" : "unsupported_text")} ${item.mime}`)
    const proc = item.pid === null ? undefined : kernel.table.get(item.pid)
    if (!proc) return note_body(`${text("process_gone")} ${item.pid ?? ""}`)
    const box = document.createElement("div")
    box.className = "desk_wbox_body_term"
    const out = document.createElement("div")
    out.className = "desk_wbox_body_term_out"
    out.setAttribute("role", "log")
    const row = document.createElement("label")
    row.className = "desk_wbox_body_term_row"
    const prompt = document.createElement("span")
    prompt.className = "desk_wbox_body_term_prompt"
    const input = document.createElement("input")
    input.className = "desk_wbox_body_term_input"
    input.type = "text"
    input.autocomplete = "off"
    input.spellcheck = false
    input.setAttribute("autocapitalize", "off")
    input.setAttribute("aria-label", text("process_input"))
    row.append(prompt, input)
    box.append(out, row)

    // everything up to the last newline is history (spans in `out`); the rest is the line in progress, which is shown as the prompt
    let tail = ""
    const append = (chunk: string, err: boolean): void => {
        if (chunk.includes("\x1b[2J")) {
            out.replaceChildren()
            tail = ""
            chunk = chunk.slice(chunk.lastIndexOf("\x1b[2J") + 4)
        }
        chunk = chunk.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\r\n/g, "\n").replace(/\r/g, "")
        const parts = (tail + chunk).split("\n")
        tail = parts.pop() ?? ""
        if (parts.length > 0) {
            const span = document.createElement("span")
            if (err) span.className = "term_err"
            span.textContent = parts.join("\n") + "\n"
            out.append(span)
            while (out.childNodes.length > 2000) out.firstChild?.remove()
        }
        prompt.textContent = tail
        box.scrollTop = box.scrollHeight
    }
    for (const entry of proc.screen) append(entry.text, entry.err)

    const finished = (): void => {
        append(`\n[pid:${proc.pid} ${text("process_exited")} ${proc.code ?? 0}]\n`, false)
        input.disabled = true
        input.placeholder = ""
    }
    const listener = (chunk: string, err: boolean): void => append(chunk, err)
    proc.listeners.add(listener)
    proc.exit_listeners.add(finished)
    if (!proc.running) finished()
    cleanups.set(item, () => {
        proc.listeners.delete(listener)
        proc.exit_listeners.delete(finished)
    })

    const history: string[] = []
    let at = 0
    input.addEventListener("keydown", event => {
        if (event.key === "Enter") {
            event.preventDefault()
            const line = input.value
            input.value = ""
            if (!proc.running) return
            if (line.trim() !== "" && history[history.length - 1] !== line) history.push(line)
            at = history.length
            // the terminal echoes what is typed, after the prompt that was waiting
            append(line + "\n", false)
            proc.stdin.write(line + "\n")
        } else if (event.ctrlKey && event.key.toLowerCase() === "c") {
            event.preventDefault()
            if (!proc.running) return
            input.value = ""
            append("^C", false)
            interrupt(proc)
        } else if (event.ctrlKey && event.key.toLowerCase() === "d" && input.value === "") {
            event.preventDefault()
            if (proc.running) proc.stdin.eof()
        } else if (event.ctrlKey && event.key.toLowerCase() === "l") {
            event.preventDefault()
            out.replaceChildren()
        } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault()
            at = Math.max(0, Math.min(history.length, at + (event.key === "ArrowUp" ? -1 : 1)))
            input.value = history[at] ?? ""
        }
    })
    box.addEventListener("click", () => {
        if (!getSelection()?.toString()) input.focus()
    })
    queueMicrotask(() => input.focus({ preventScroll: true }))
    return box
}

// ---- wiring -------------------------------------------------------------------------------------------------------------------------

export function init_proc(): void {
    kernel.hooks = {
        programs: async () => {
            const programs = await load_runtime()
            program_names = Object.keys(programs).sort()
            return programs
        },
        fs: () => fs,
    }
    const fs = make_fs(() => program_names)
    process_hooks.body = terminal_body
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
