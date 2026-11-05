import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"

export type cache_data = Record<string, string>

export function cache_file(root: string): string {
    return join(root, ".cache", "hashes.json")
}

export function load_cache(root: string): cache_data {
    const file = cache_file(root)
    return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as cache_data) : {}
}

export function save_cache(root: string, data: cache_data): void {
    const file = cache_file(root)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(data, null, 4))
}
