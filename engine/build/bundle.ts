/* Bundle browser runtime and verified WASM inputs into hashed output assets. */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs"
import { join, dirname, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { build as esbuild_build } from "esbuild"
import type { page } from "../load/model.ts"
import type { output_files } from "../style/theme.ts"
import { sha256 } from "../../shared/util.ts"
const runtime_entries: Record<string, string> = {
    "boot": "desk/site/boot.ts",
    "connect_folder": "desk/fs/personal.ts",
    "desk": "desk/index.ts",
    "desk_compare": "desk/plugin/compare.ts",
    "desk_files_util": "desk/window/folder/files.ts",
    "desk_flow": "desk/plugin/flow.ts",
    "desk_flow_rules": "desk/plugin/rules.ts",
    "desk_folder": "desk/window/folder.ts",
    "desk_folder_context": "desk/window/folder/context.ts",
    "desk_folder_cover": "desk/window/folder/cover.ts",
    "desk_folder_drag": "desk/window/folder/drag.ts",
    "desk_folder_drop": "desk/window/folder/drop.ts",
    "desk_fs": "desk/fs/opfs.ts",
    "desk_fs_permissions": "desk/fs/permissions.ts",
    "desk_host": "desk/host/host.ts",
    "desk_markdown": "desk/window/note.ts",
    "desk_media": "desk/window/media.ts",
    "desk_messages": "desk/window/messages.ts",
    "desk_mime": "desk/mime/detect.ts",
    "desk_navigation": "desk/action/history.ts",
    "desk_paths": "desk/fs/paths.ts",
    "desk_pdf": "desk/window/media/pdf.ts",
    "desk_plugins": "desk/plugin/loader.ts",
    "desk_preview": "desk/window/preview.ts",
    "desk_previews": "desk/window/previews.ts",
    "desk_proc": "desk/host/proc.ts",
    "desk_selection": "desk/window/folder/selection.ts",
    "desk_server": "desk/server/desk.ts",
    "desk_server_owner": "desk/server/owner.ts",
    "desk_shell": "desk/window/shell.ts",
    "desk_syntax": "desk/window/text/syntax.ts",
    "desk_users": "desk/work/users.ts",
    "desk_vfs": "desk/fs/vfs.ts",
    "desk_view": "desk/window/index.ts",
    "desk_window_controls": "desk/action/controls.ts",
    "expertise": "desk/site/expertise.ts",
    "home_directory": "desk/fs/home.ts",
    "kernel": "desk/kernel/process.ts",
    "llvm_service": "desk/program/gcc/service.ts",
    "loading": "desk/site/loading.ts",
    "memory_fs": "desk/fs/memory.ts",
    "menus": "desk/site/menus.ts",
    "notifications": "desk/site/notifications.ts",
    "page": "desk/site/page.ts",
    "pager": "desk/site/pager.ts",
    "print": "desk/site/print.ts",
    "proc_types": "desk/kernel/types.ts",
    "pwa": "desk/site/pwa.ts",
    "realtime": "desk/work/realtime.ts",
    "realtime_time": "desk/work/time.ts",
    "rireki_editor": "desk/site/rireki_editor.ts",
    "scroll": "desk/site/scroll.ts",
    "search": "desk/site/search.ts",
    "server_audio": "desk/server/audio.ts",
    "server_fs": "desk/server/fs.ts",
    "server_input": "desk/server/input.ts",
    "server_link": "desk/server/link.ts",
    "server_pty": "desk/server/pty.ts",
    "server_script": "desk/server/script.ts",
    "server_script_model": "desk/server/script_model.ts",
    "server_sessions": "desk/server/sessions.ts",
    "server_sessions_model": "desk/server/sessions_model.ts",
    "server_site": "desk/server/site.ts",
    "server_terminal": "desk/server/terminal.ts",
    "server_text": "desk/server/text.ts",
    "server_touch": "desk/server/touch.ts",
    "server_windows": "desk/server/windows.ts",
    "sign": "desk/work/sign.ts",
    "spa": "desk/site/spa.ts",
    "theme_switch": "desk/site/theme_switch.ts",
    "wasm_host": "desk/kernel/wasm_host.ts",
    "wasm_procfs": "desk/kernel/procfs.ts",
    "wasm_protocol": "desk/kernel/wasm_protocol.ts",
    "wasm_worker": "desk/kernel/worker.ts",
    "wasm_worker_runtime": "desk/kernel/worker_runtime.ts",
    "work_drive": "desk/work/drive.ts",
    "work_session": "desk/work/session.ts"
}

async function bundle_script(root: string, entry: string, files: output_files, mode: string): Promise<string> {
    const outdir = join(root, ".cache", "runtime")
    const result = await esbuild_build({
        entryPoints: [{ in: join(root, runtime_entries[entry]), out: entry }], outdir, write: false, bundle: true, format: "iife",
        minify: mode === "production", entryNames: "assets/runtime/[name].[hash]", target: "es2020", logLevel: "silent",
        external: ["node:*", "ws", "@wasmer/sdk"],
    })
    const output = result.outputFiles[0]
    const rel = relative(outdir, output.path).replace(/\\/g, "/")
    files.set(rel, Buffer.from(output.contents))
    return "/" + rel
}

export async function bundle_runtime(root: string, files: output_files, mode: string): Promise<{ page: string, theme_switch: string, desk_shell: string, boot: string }> {
    const build_dir = join(root, "build")
    const bb_dir = join(build_dir, "busybox")
    const worker = await bundle_script(root, "wasm_worker", files, mode)
    const wasm_bytes = readFileSync(join(bb_dir, "busybox.wasm"))
    const hash = sha256(wasm_bytes)
    const wasm_path = `assets/wasm/busybox-${hash.slice(0, 10)}.wasm`
    files.set(wasm_path, wasm_bytes)
    files.set("assets/wasm/busybox-LICENSE", readFileSync(join(bb_dir, "LICENSE")))
    files.set("assets/wasm/busybox.config", readFileSync(join(bb_dir, "busybox.config")))
    files.set("assets/terminal/xterm-5.5.0.css", readFileSync(fileURLToPath(import.meta.resolve("@xterm/xterm/css/xterm.css"))))
    const media_root = join(dirname(fileURLToPath(import.meta.resolve("mediabunny"))), "../../..")
    const media_version = JSON.parse(readFileSync(join(media_root, "package.json"), "utf8")).version as string
    files.set("assets/vendor/mediabunny-LICENSE.txt", readFileSync(join(media_root, "LICENSE")))
    files.set("assets/vendor/mediabunny-NOTICE.txt", `Mediabunny ${media_version}\nUnmodified library bundled for blog video export.\nLicense: Mozilla Public License 2.0 (mediabunny-LICENSE.txt).\nSource package: https://registry.npmjs.org/mediabunny/-/mediabunny-${media_version}.tgz\n`)
    files.set("assets/wasm/busybox-source.tar.bz2", readFileSync(join(bb_dir, "busybox-source.tar.bz2")))
    for (const name of ["build.sh", "port.py", "host.c"]) {
        const p = join(root, "desk/program/busybox", name)
        if (existsSync(p)) files.set(`assets/wasm/busybox-port/${name}`, readFileSync(p))
    }
    const loader = async (name: string): Promise<string> => {
        const bundled = await esbuild_build({ entryPoints: [join(build_dir, name, `${name}.js`)], bundle: true, write: false, format: "esm", minify: mode === "production", target: "es2020", external: ["node:*", "ws", "@wasmer/sdk"], logLevel: "silent" })
        const bytes = bundled.outputFiles[0].contents
        const path = `assets/wasm/${name}-${sha256(bytes).slice(0, 10)}.mjs`
        files.set(path, Buffer.from(bytes))
        return "/" + path
    }
    const images: { id: string, version: string, worker: string, loader: string, runtime?: string, applet: boolean, wasm: string, sha256: string, commands: string[], license: string, source: string }[] = [{ id: "busybox", loader: await loader("busybox"), applet: true, version: "1.36.1-jazu.2", worker, wasm: "/" + wasm_path, sha256: hash,
        commands: JSON.parse(readFileSync(join(bb_dir, "commands.json"), "utf8")) as string[], license: "/assets/wasm/busybox-LICENSE", source: "/assets/wasm/busybox-source.tar.bz2" }]
    const programs = readdirSync(join(root, "desk/program"), { withFileTypes: true }).filter(entry => entry.isDirectory() && entry.name !== "busybox" && existsSync(join(root, "desk/program", entry.name, "program.json"))).map(entry => JSON.parse(readFileSync(join(root, "desk/program", entry.name, "program.json"), "utf8")))
    for (const program of programs) {
        const { name, version, extension, commands: cmd_list } = program

        const pkg_dir = join(build_dir, name)
        const bytes = readFileSync(join(pkg_dir, `${name}.wasm`)), hash = sha256(bytes)
        if (hash !== program.sha256) throw new Error(`Program integrity differs from desk/program/${name}/program.json`)
        const path = `assets/wasm/${name}-${hash.slice(0, 10)}.wasm`
        files.set(path, bytes)
        const lic_path = existsSync(join(pkg_dir, `${name}-LICENSE`)) ? join(pkg_dir, `${name}-LICENSE`) : join(pkg_dir, "LICENSE")
        files.set(`assets/wasm/${name}-LICENSE`, readFileSync(lic_path))
        files.set(`assets/wasm/${name}-source.${extension}`, readFileSync(join(pkg_dir, `${name}-source.${extension}`)))
        let runtime: string | undefined
        if (program.runtime) {
            const compiled = await esbuild_build({ entryPoints: [join(root, program.runtime)], bundle: true, write: false, format: "esm", minify: mode === "production", external: ["node:*", "ws", "@wasmer/sdk"], logLevel: "silent" })
            const path = `assets/wasm/${name}-runtime-${sha256(compiled.outputFiles[0].contents).slice(0, 10)}.mjs`
            files.set(path, Buffer.from(compiled.outputFiles[0].contents))
            runtime = "/" + path
        }
        images.push({ runtime, id: name, version, worker, loader: await loader(name), applet: false, wasm: "/" + path, sha256: hash, commands: cmd_list ?? [name], license: `/assets/wasm/${name}-LICENSE`, source: `/assets/wasm/${name}-source.${extension}` })
    }
    const extra_assets: [string, string][] = [
        ["htop", "ncurses-source.tar.gz"],
        ["tcc", "tcc-sysroot.json"],
        ["tcc", "tcc-sysroot-LICENSE"],
        ["python_suite", "python_stdlib.zip"],
        ["python_suite", "pyodide.asm.js"],
        ["python_suite", "pyodide-lock.json"],
        ["python_suite", "pyodide.asm.wasm"],
        ["python_suite", "numpy-2.0.2-cp312-cp312-pyodide_2024_0_wasm32.whl"],
        ["clang", "clang.webc"],
    ]
    for (const [pkg, asset] of extra_assets) {
        const p = join(build_dir, pkg, asset)
        if (existsSync(p)) files.set(`assets/wasm/${asset}`, readFileSync(p))
    }
    const common_custom = join(root, "desk/program/common")
    for (const name of ["build.sh", "port.py", "compat.c", "package.ts"]) {
        const p = join(common_custom, name)
        if (existsSync(p)) files.set(`assets/wasm/programs-port/${name}`, readFileSync(p))
    }
    const wasmer_root = join(root, "node_modules", "@wasmer", "sdk")
    if (existsSync(wasmer_root)) {
        for (const dir of ["dist", "pkg"]) {
            const dir_path = join(wasmer_root, dir)
            if (existsSync(dir_path)) {
                for (const file of readdirSync(dir_path, { recursive: true })) {
                    const full = join(dir_path, String(file))
                    if (statSync(full).isFile()) {
                        const rel = relative(wasmer_root, full).replace(/\\/g, "/")
                        files.set(`assets/wasmer/${rel}`, readFileSync(full))
                    }
                }
            }
        }
    }
    files.set("assets/wasm/manifest.json", JSON.stringify(images))
    // PDF editing is lazy and versioned independently of the desk shell.
    const tools_root = dirname(fileURLToPath(import.meta.resolve("pdf-lib/package.json")))
    const tools_version = JSON.parse(readFileSync(join(tools_root, "package.json"), "utf8")).version
    const tools_path = `assets/pdf-tools/${tools_version}/pdf-lib.mjs`
    files.set(tools_path, readFileSync(join(tools_root, "dist/pdf-lib.esm.min.js")))
    files.set(`assets/pdf-tools/${tools_version}/LICENSE`, readFileSync(join(tools_root, "LICENSE.md")))
    files.set("assets/pdf-tools.json", JSON.stringify({ module: "/" + tools_path }))
    // PDF.js stays out of the page bundle and is fetched only when a PDF is opened.
    const pdf_root = dirname(fileURLToPath(import.meta.resolve("pdfjs-dist/package.json")))
    const pdf_version = JSON.parse(readFileSync(join(pdf_root, "package.json"), "utf8")).version
    const pdf_base = `assets/pdfjs/${pdf_version}`
    for (const folder of ["build", "cmaps", "standard_fonts", "wasm"]) {
        for (const name of readdirSync(join(pdf_root, folder), { recursive: true })) {
            const path = join(pdf_root, folder, String(name))
            if (statSync(path).isFile() && !String(name).endsWith(".map") && (folder !== "build" || ["pdf.min.mjs", "pdf.worker.min.mjs"].includes(String(name)))) {
                files.set(`${pdf_base}/${folder}/${String(name).replace(/\\/g, "/")}`, readFileSync(path))
            }
        }
    }
    files.set(`${pdf_base}/LICENSE`, readFileSync(join(pdf_root, "LICENSE")))
    files.set("assets/pdfjs.json", JSON.stringify({ base: `/${pdf_base}/`, module: `/${pdf_base}/build/pdf.min.mjs`, worker: `/${pdf_base}/build/pdf.worker.min.mjs` }))
    const page = await bundle_script(root, "page", files, mode)
    const theme_switch = await bundle_script(root, "theme_switch", files, mode)
    // Executable registration is small; WASM bytes remain lazy until a process starts.
    const desk_shell = await bundle_script(root, "desk_shell", files, mode)
    const boot = await esbuild_build({ entryPoints: [join(root, "desk/site/boot.ts")], bundle: true, write: false, format: "iife", minify: true, logLevel: "silent" })
    return { page, theme_switch, desk_shell, boot: boot.outputFiles[0].text.trim() }
}
