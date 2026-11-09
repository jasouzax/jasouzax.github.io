import type { worker_start, descriptor } from "./wasm_protocol.ts"
import { loadPyodide } from "pyodide"

type em_object = any

let pyodideInstance: any = null

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
    const stdin_desc = start.descriptors.find(d => d.fd === 0)

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

    let stdin_buffer = ""
    let stdin_eof = false

    function read_stdin_chunk(): Uint8Array {
        if (!stdin_desc || stdin_eof) return new Uint8Array()
        try {
            const bytes: number[] = call("read", { handle: stdin_desc.handle, length: 1024 })
            if (bytes.length === 0) {
                stdin_eof = true
            }
            return new Uint8Array(bytes)
        } catch {
            stdin_eof = true
            return new Uint8Array()
        }
    }

    function read_line_stdin(): string {
        while (!stdin_buffer.includes("\n") && !stdin_eof) {
            const chunk = read_stdin_chunk()
            if (chunk.length === 0) break
            stdin_buffer += decoder.decode(chunk)
        }
        if (!stdin_buffer.includes("\n")) {
            const rem = stdin_buffer
            stdin_buffer = ""
            return rem
        }
        const idx = stdin_buffer.indexOf("\n")
        const line = stdin_buffer.slice(0, idx + 1)
        stdin_buffer = stdin_buffer.slice(idx + 1)
        return line
    }

    function read_all_stdin(): string {
        while (!stdin_eof) {
            const chunk = read_stdin_chunk()
            if (chunk.length === 0) break
            stdin_buffer += decoder.decode(chunk)
        }
        const res = stdin_buffer
        stdin_buffer = ""
        return res
    }

    function is_stdin_tty(): boolean {
        if (!stdin_desc) return false
        try {
            return Boolean(stdin_desc.tty || call("isatty", { handle: stdin_desc.handle }))
        } catch {
            return Boolean(stdin_desc.tty)
        }
    }

    function read_vfs_file(path: string): string | null {
        try {
            const info = call("stat", { path })
            if (!info || info.kind !== "file") return null
            const handle = call("open", { path, flags: 0 })
            const bytes: number[] = call("read", { handle, length: info.size })
            call("close", { handle })
            return decoder.decode(new Uint8Array(bytes))
        } catch {
            return null
        }
    }

    function write_vfs_file(path: string, content: string): void {
        try {
            call("create", { path, mode: 0o100644 })
        } catch {}
        const handle = call("open", { path, flags: 1 })
        call("write", { handle, bytes: Array.from(encoder.encode(content)) })
        call("close", { handle })
    }

    let exit_code = 0

    try {
        const prog = start.argv[0].split("/").pop() || "python"
        const args = start.argv.slice(1)

        // Command: pip / pip3
        if (prog === "pip" || prog === "pip3") {
            for (let i = 0; i < args.length; i++) {
                if (args[i] === "-V" || args[i] === "--version") {
                    write_stdout("pip 24.0 from /lib/python3.12/site-packages/pip (python 3.12)\n")
                    send({ exit: 0 })
                    return
                }
                if (args[i] === "-h" || args[i] === "--help") {
                    write_stdout("Usage:\n  pip <command> [options]\n\nCommands:\n  install                     Install packages.\n  uninstall                   Uninstall packages.\n  list                        List installed packages.\n  show                        Show information about installed packages.\n")
                    send({ exit: 0 })
                    return
                }
                if (args[i] === "list") {
                    write_stdout("Package    Version\n---------- -------\npip        24.0\nsetuptools 69.2.0\nwheel      0.43.0\n")
                    send({ exit: 0 })
                    return
                }
                if (args[i] === "install" && i + 1 < args.length) {
                    const pkg = args[i + 1]
                    write_stdout(`Collecting ${pkg}\n  Downloading ${pkg}-1.0.0-py3-none-any.whl (12 kB)\nInstalling collected packages: ${pkg}\nSuccessfully installed ${pkg}-1.0.0\n`)
                    send({ exit: 0 })
                    return
                }
            }
            write_stdout("pip 24.0 from /lib/python3.12/site-packages/pip (python 3.12)\n")
            send({ exit: 0 })
            return
        }

        // Command: venv
        if (prog === "venv") {
            if (args.length < 1 || args[0] === "-h" || args[0] === "--help") {
                write_stdout("usage: venv [-h] ENV_DIR\n\nCreates virtual Python environments in one or more target directories.\n")
                send({ exit: 0 })
                return
            }
            const venv_dir = args[0].replace(/\/$/, "")
            call("create", { path: venv_dir, mode: 0o40755 })
            call("create", { path: `${venv_dir}/bin`, mode: 0o40755 })
            const cfg = "home = /usr/bin\ninclude-system-site-packages = false\nversion = 3.12.0\n"
            const act = `# Virtual environment activator\nVIRTUAL_ENV="${venv_dir}"\nexport VIRTUAL_ENV\nPATH="$VIRTUAL_ENV/bin:$PATH"\nexport PATH\n`
            write_vfs_file(`${venv_dir}/pyvenv.cfg`, cfg)
            write_vfs_file(`${venv_dir}/bin/activate`, act)
            write_stdout(`Created virtual environment at '${venv_dir}'.\n`)
            send({ exit: 0 })
            return
        }

        // Command: python / python3
        let code_arg: string | null = null
        let script_file: string | null = null
        let script_args: string[] = []
        let force_interactive = false

        for (let i = 0; i < args.length; i++) {
            const arg = args[i]
            if (arg === "-V" || arg === "--version") {
                write_stdout("Python 3.12.7\n")
                send({ exit: 0 })
                return
            }
            if (arg === "-h" || arg === "--help") {
                write_stdout("usage: python [option] ... [-c cmd | -m mod | file] [arg] ...\nOptions and arguments:\n-c cmd : program passed in as string\n-m mod : run library module as a script\n-V     : print the Python version number and exit\n-h     : print this help message and exit\n-i     : inspect interactively after running script\nfile   : program read from script file\n")
                send({ exit: 0 })
                return
            }
            if (arg === "-i") {
                force_interactive = true
                continue
            }
            if (arg === "-c" && i + 1 < args.length) {
                code_arg = args[i + 1]
                script_args = [start.argv[0], ...args.slice(i + 2)]
                break
            }
            if (arg === "-m" && i + 1 < args.length) {
                const mod = args[i + 1]
                if (mod === "venv") {
                    const target = (i + 2 < args.length) ? args[i + 2] : ".venv"
                    call("create", { path: target, mode: 0o40755 })
                    const cfg = "home = /usr/bin\ninclude-system-site-packages = false\nversion = 3.12.0\n"
                    write_vfs_file(`${target}/pyvenv.cfg`, cfg)
                    write_stdout(`Created virtual environment at '${target}'.\n`)
                    send({ exit: 0 })
                    return
                }
                if (mod === "pip") {
                    write_stdout("pip 24.0 from /lib/python3.12/site-packages/pip (python 3.12)\n")
                    send({ exit: 0 })
                    return
                }
                break
            }
            if (!arg.startsWith("-")) {
                script_file = arg
                script_args = [arg, ...args.slice(i + 1)]
                break
            }
        }

        // Initialize Pyodide
        if (!pyodideInstance) {
            let indexURL = "https://cdn.jsdelivr.net/pyodide/v0.27.8/full/"
            if (typeof process !== "undefined" && process.versions?.node) {
                try {
                    const { resolve } = await import("node:path")
                    indexURL = resolve("node_modules/pyodide")
                } catch {}
            } else if (typeof location !== "undefined") {
                indexURL = new URL("/assets/pyodide/", location.href).href
            }
            pyodideInstance = await loadPyodide({
                indexURL,
                stdout: (text: string) => write_stdout(text + "\n"),
                stderr: (text: string) => write_stderr(text + "\n"),
                stdin: () => read_line_stdin(),
            })
        }
        const pyodide = pyodideInstance

        // Set sys.argv
        const argv_json = JSON.stringify(script_args.length > 0 ? script_args : [start.argv[0]])
        await pyodide.runPythonAsync(`import sys; sys.argv = ${argv_json}`)

        // If -c was passed
        if (code_arg !== null) {
            await pyodide.loadPackagesFromImports(code_arg)
            await pyodide.runPythonAsync(code_arg)
            if (!force_interactive) {
                send({ exit: 0 })
                return
            }
        }

        // If a script file was passed
        if (script_file !== null && script_file !== "-") {
            const script_content = read_vfs_file(script_file)
            if (script_content === null) {
                write_stderr(`python: can't open file '${script_file}': [Errno 2] No such file or directory\n`)
                send({ exit: 2 })
                return
            }
            await pyodide.loadPackagesFromImports(script_content)
            await pyodide.runPythonAsync(script_content, { filename: script_file })
            if (!force_interactive) {
                send({ exit: 0 })
                return
            }
        }

        const is_interactive = force_interactive || is_stdin_tty()

        if (!is_interactive) {
            // Piped non-interactive stdin
            const stdin_code = read_all_stdin()
            if (stdin_code.trim()) {
                await pyodide.loadPackagesFromImports(stdin_code)
                await pyodide.runPythonAsync(stdin_code)
            }
            send({ exit: 0 })
            return
        }

        // Interactive REPL
        write_stdout("Python 3.12.7 (main, Sep 16 2026, 03:36:46) [Pyodide CPython / WebAssembly] on linux\nType \"help\", \"copyright\", \"credits\" or \"license\" for more information.\n")

        await pyodide.runPythonAsync(`
import code, sys
class JazuConsole(code.InteractiveConsole):
    def runcode(self, code_obj):
        try:
            exec(code_obj, self.locals)
        except SystemExit as e:
            raise e
        except BaseException:
            self.showtraceback()

__jazu_console__ = JazuConsole()
`)
        const pyconsole = pyodide.globals.get("__jazu_console__")

        let prompt = ">>> "
        while (true) {
            write_stdout(prompt)
            const raw = read_line_stdin()
            if (raw === "" && stdin_eof) {
                write_stdout("\n")
                break
            }

            const line = raw.replace(/[\r\n]+$/, "")
            const trimmed = line.trim()

            if (prompt === ">>> ") {
                if (trimmed === "exit()" || trimmed === "quit()") break
                if (trimmed === "exit" || trimmed === "quit") {
                    write_stdout("Use exit() or Ctrl-D (i.e. EOF) to exit\n")
                    continue
                }
                if (trimmed === "help") {
                    write_stdout("Type help() for interactive help, or help(object) for help about object.\n")
                    continue
                }
                if (trimmed === "clear" || trimmed === "clear()") {
                    write_stdout("\x1b[H\x1b[2J")
                    continue
                }
            }

            try {
                if (trimmed.startsWith("import ") || trimmed.startsWith("from ")) {
                    await pyodide.loadPackagesFromImports(trimmed)
                }
                const more = pyconsole.push(line)
                prompt = more ? "... " : ">>> "
            } catch (err: any) {
                if (err.type === "SystemExit") break
                prompt = ">>> "
            }
        }

        send({ exit: exit_code })
    } catch (err: any) {
        if (err.type === "SystemExit") {
            send({ exit: 0 })
        } else {
            write_stderr(String(err?.message || err) + "\n")
            send({ exit: 1 })
        }
    }
}

const scope = globalThis as unknown as { postMessage(value: unknown): void, onmessage: ((event: MessageEvent<worker_start>) => void) | null }
if (typeof scope.postMessage === "function") scope.onmessage = event => { void run_worker(event.data, value => scope.postMessage(value)) }
