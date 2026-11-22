/* Write changed output bytes and retain their hashes for cache validation. */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs"
import { dirname } from "node:path"
import type { output_files } from "../style/theme.ts"
import { sha256 } from "../../shared/util.ts"
import { output_file } from "../../shared/paths.ts"

export function disk_hash(file: string): string | null {
    return existsSync(file) ? sha256(readFileSync(file)) : null
}

export function write_files(out: string, files: output_files): { written: string[], hashes: Record<string, string> } {
    const written: string[] = []
    const hashes: Record<string, string> = {}
    for (const [name, content] of files) {
        const target = output_file(out, name)
        const hash = sha256(content)
        hashes[name] = hash
        if (disk_hash(target) === hash) continue
        mkdirSync(dirname(target), { recursive: true })
        writeFileSync(target, content)
        written.push(name)
    }
    return { written, hashes }
}
