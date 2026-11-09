import { readFileSync, writeFileSync, readdirSync, statSync, copyFileSync, existsSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
const root = dirname(fileURLToPath(import.meta.url)), artifact = join(root, "artifacts")
const work = process.argv[2], sdk = process.argv[3]
const sysroot_json_path = join(artifact, "tcc-sysroot.json")
if (!work || !sdk) {
    if (existsSync(sysroot_json_path)) {
        const files = JSON.parse(readFileSync(sysroot_json_path, "utf8"))
        const runtime = join(root, "sources/group19/runtime")
        if (existsSync(runtime)) {
            for (const [key, filename] of [
                ["lib/crt1.o", "crt1.o"],
                ["lib/crti.o", "crti.o"],
                ["lib/crtn.o", "crtn.o"],
                ["lib/libc.a", "libc.a"],
                ["lib/tcc/libtcc1.a", "libtcc1.a"],
            ]) {
                const file_path = join(runtime, filename)
                if (existsSync(file_path)) files[key] = readFileSync(file_path, "base64")
            }
        }
        writeFileSync(sysroot_json_path, JSON.stringify(files))
        console.log(`Updated runtime sysroot with ${Object.keys(files).length} files`)
        process.exit(0)
    }
    throw new Error("Usage: package.ts WORK EMSDK")
}
for (const [name, source, archive, extension, license] of [
    ["fastfetch", "fastfetch-2.40.4", "fastfetch.tar.gz", "tar.gz", "LICENSE"],
    ["htop", "htop-3.4.1", "htop.tar.gz", "tar.gz", "COPYING"],
    ["tcc", "tcc-0.9.27", "tcc.tar.bz2", "tar.bz2", "COPYING"],
    ["jq", "jq-1.7.1", "jq.tar.gz", "tar.gz", "COPYING"],
]) {
    if (!existsSync(join(artifact, `${name}.wasm`))) throw new Error(`Missing compiled program: ${name}`)
    copyFileSync(join(work, archive), join(artifact, `${name}-source.${extension}`))
    let text = readFileSync(join(work, source, license), "utf8")
    if (name === "htop") text += "\n\nNcurses 6.5:\n" + readFileSync(join(work, "ncurses-6.5/COPYING"), "utf8")
    writeFileSync(join(artifact, `${name}-LICENSE`), text)
}
copyFileSync(join(work, "ncurses.tar.gz"), join(artifact, "ncurses-source.tar.gz"))
const headers = join(sdk, "upstream/emscripten/cache/sysroot/include"), files: Record<string, string> = {}
const selected = new Set(["assert.h", "ctype.h", "errno.h", "features.h", "float.h", "inttypes.h", "limits.h", "math.h", "setjmp.h", "signal.h", "stdalign.h", "stdarg.h", "stdbool.h", "stddef.h", "stdint.h", "stdio.h", "stdlib.h", "stdnoreturn.h", "string.h", "strings.h", "time.h", "unistd.h", "wchar.h", "wctype.h", "sys", "bits"])
function add(base: string, path: string, prefix: string) {
    if (statSync(path).isDirectory()) for (const name of readdirSync(path)) add(base, join(path, name), prefix)
    else files[prefix + relative(base, path).replace(/\\/g, "/")] = readFileSync(path, "utf8")
}
for (const name of selected) if (existsSync(join(headers, name))) add(headers, join(headers, name), "")
const own = join(work, "tcc-0.9.27/include")
for (const name of readdirSync(own)) if (name.endsWith(".h")) add(own, join(own, name), "")
files["tcclib.h"] = readFileSync(join(work, "tcc-0.9.27/tcclib.h"), "utf8")
// The SDK's musl headers expect Clang target macros; TinyCC's i386 backend
// supplies C types directly instead. Match the emitted object's 32-bit ABI.
const target: Record<string, string> = {
    __PTRDIFF_TYPE__: "int", __SIZE_TYPE__: "unsigned int", __INT64_TYPE__: "long long",
    __WCHAR_TYPE__: "int", __WINT_TYPE__: "unsigned int", __LONG_MAX__: "2147483647L", __builtin_va_list: "char *",
    __INTPTR_MAX__: "2147483647", __UINTPTR_MAX__: "4294967295U", __PTRDIFF_MAX__: "2147483647", __SIZE_MAX__: "4294967295U",
}
for (const name of ["bits/alltypes.h", "bits/stdint.h"]) for (const [macro, value] of Object.entries(target)) files[name] = files[name].replaceAll(macro, value)
const runtime = join(root, "sources/group19/runtime")
if (existsSync(runtime)) {
    for (const [key, filename] of [
        ["lib/crt1.o", "crt1.o"],
        ["lib/crti.o", "crti.o"],
        ["lib/crtn.o", "crtn.o"],
        ["lib/libc.a", "libc.a"],
        ["lib/tcc/libtcc1.a", "libtcc1.a"],
    ]) {
        const file_path = join(runtime, filename)
        if (existsSync(file_path)) files[key] = readFileSync(file_path, "base64")
    }
}
writeFileSync(join(artifact, "tcc-sysroot.json"), JSON.stringify(files))
writeFileSync(join(artifact, "tcc-sysroot-LICENSE"), readFileSync(join(sdk, "upstream/emscripten/system/lib/libc/musl/COPYRIGHT"), "utf8") + "\nTinyCC headers:\n" + readFileSync(join(work, "tcc-0.9.27/COPYING"), "utf8"))
console.log(`Packaged 4 native WASM programs and ${Object.keys(files).length} compiler headers`)
