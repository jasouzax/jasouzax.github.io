/* Split an image payload into bounded filesystem layers so public registry uploads stay below proxy limits. */
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, symlinkSync } from "node:fs"
import { createHash } from "node:crypto"
import { dirname, join, relative, resolve } from "node:path"
import { gzipSync } from "node:zlib"

const [source, destination] = process.argv.slice(2).map(path => resolve(path))
if (!source || !destination) throw new Error("usage: layers.ts <payload> <layers-directory>")
for (let index = 0; index < 20; index++) mkdirSync(join(destination, String(index).padStart(2, "0")), { recursive: true })
let index = 0, bytes = 0
const hashes = new Map<string, string>()
function visit(path: string): void {
    for (const entry of readdirSync(path).sort()) {
        const file = join(path, entry), stat = lstatSync(file)
        if (stat.isDirectory()) { visit(file); continue }
        const name = relative(source, file)
        if (stat.isFile() && stat.size > 99 * 1024 * 1024 && gzipSync(readFileSync(file)).length > 99 * 1024 * 1024) throw new Error(`Compressed image input exceeds 99 MiB: ${name}; store it separately or split it before packaging`)
        if (bytes && bytes + stat.size > 64 * 1024 * 1024) { index++; bytes = 0 }
        if (index >= 20) throw new Error("Image payload exceeds the supported 20 layers")
        const output = join(destination, String(index).padStart(2, "0"), name)
        mkdirSync(dirname(output), { recursive: true })
        if (stat.isFile() && stat.size > 65536) {
            const hash = createHash("sha256").update(readFileSync(file)).digest("hex")
            const existing = hashes.get(hash)
            if (existing) { symlinkSync(relative(dirname(name), existing), output); continue }
            hashes.set(hash, name)
        }
        cpSync(file, output, { dereference: false, verbatimSymlinks: true })
        bytes += stat.size
    }
}
visit(source)
console.log(`Prepared ${index + 1} bounded application layers`)
