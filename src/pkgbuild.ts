import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, copyFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"

const root = resolve(".")
const build_dir = join(root, "build")

function ensure_dir(dir: string): void {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

const DTS_CONTENT = `declare function createProgram(options?: any): Promise<any>;
export default createProgram;
`

const custom_packages = [
    "urlencode", "htmlencode", "rot13", "atob", "btoa", "sha384sum",
    "json_flatten", "csv_json", "json2yaml", "ini_env_json", "casing_tools",
    "text_stats", "text_gen", "banner", "word_games", "numbase", "random_bytes",
    "math_suite", "uuid_token", "color_tools", "date_units", "qr", "net_tools",
    "file_analysis", "string_helpers", "markup_tools", "tools_catalog",
    "encoding_suite", "xml_suite", "yq", "csv_suite", "pdf_suite",
    "postscript_suite", "doc_suite", "image_suite", "audio_suite",
    "disk_archive_suite", "linux_suite", "exec_suite", "gcc", "make",
    "python_suite", "rust_suite", "jvm_suite", "perl_suite", "lang_suite"
]

export function build_packages(options: { check_only?: boolean } = {}): void {
    ensure_dir(build_dir)
    let missing_count = 0

    // 1. Check Busybox
    const bb_dir = join(build_dir, "busybox")
    ensure_dir(bb_dir)
    for (const f of ["busybox.wasm", "busybox.js", "busybox.d.ts", "commands.json", "LICENSE"]) {
        if (!existsSync(join(bb_dir, f))) {
            console.warn(`[pkgbuild] Warning: missing busybox artifact: ${f}`)
            missing_count++
        }
    }

    // 2. Process Custom packages
    for (const name of custom_packages) {
        const pkg_dir = join(build_dir, name)
        ensure_dir(pkg_dir)
        const custom_dir = join(pkg_dir, "custom")

        // Ensure .d.ts exists
        const dts_file = join(pkg_dir, `${name}.d.ts`)
        if (!existsSync(dts_file)) {
            writeFileSync(dts_file, DTS_CONTENT)
        }

        // Ensure LICENSE exists in pkg_dir
        const lic_file = join(pkg_dir, `${name}-LICENSE`)
        if (!existsSync(lic_file) && existsSync(join(custom_dir, "LICENSE"))) {
            copyFileSync(join(custom_dir, "LICENSE"), lic_file)
        }

        const wasm_file = join(pkg_dir, `${name}.wasm`)
        const js_file = join(pkg_dir, `${name}.js`)

        if (!existsSync(wasm_file) || !existsSync(js_file)) {
            console.warn(`[pkgbuild] Warning: missing compiled artifact for ${name}: ${!existsSync(wasm_file) ? `${name}.wasm` : `${name}.js`}`)
            missing_count++
        }
    }

    // 3. Check Clang
    const clang_dir = join(build_dir, "clang")
    ensure_dir(clang_dir)
    if (!existsSync(join(clang_dir, "clang.webc"))) {
        console.warn(`[pkgbuild] Warning: missing clang.webc in ${clang_dir}`)
        missing_count++
    }

    // 4. Check Pyodide & Python assets
    const py_dir = join(build_dir, "python_suite")
    for (const f of ["pyodide.asm.wasm", "pyodide.asm.js", "python_stdlib.zip"]) {
        if (!existsSync(join(py_dir, f))) {
            console.warn(`[pkgbuild] Warning: missing python asset: ${f}`)
            missing_count++
        }
    }

    if (missing_count > 0) {
        console.log(`[pkgbuild] Finished with ${missing_count} missing artifact(s).`)
    } else {
        console.log("[pkgbuild] All packages and artifacts verified successfully.")
    }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"))) {
    build_packages()
}

