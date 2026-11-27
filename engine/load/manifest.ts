/** Optional derived cache. Schema validation and model transformations still run on fresh trees. */
import { readFileSync, statSync, existsSync, readdirSync, mkdirSync, writeFileSync, renameSync, unlinkSync } from "node:fs"
import { join, relative, resolve, dirname } from "node:path"
import { execFileSync } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import { parse_xml, type xml_node } from "../../shared/content/xml.ts"

type Entry = { stamp: string, hash?: string, tree?: string }
type Manifest = { version: number, root: string, head: string, parser: string, compiled_at: string, files: Record<string, Entry> }
const parser_revision = createHash("sha256").update(readFileSync(fileURLToPath(new URL("../../shared/content/xml.ts", import.meta.url)))).update(readFileSync(createRequire(import.meta.url).resolve("saxes/package.json"))).digest("hex")
const stamp = (file: string) => {
    const info = statSync(file, { bigint: true })
    return [info.size, info.mtimeNs, info.ctimeNs, info.ino, info.mode].join(":")
}
const git = (root: string, args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }).trim()

export class Source_Manifest {
    readonly stats = { parsed: 0, reused: 0, hashed: 0, hash_reused: 0 }
    readonly #root: string
    readonly #path: string
    readonly #data: Manifest
    readonly #changed = new Set<string>()
    readonly #seen = new Set<string>()
    #invalidate = false
    constructor(root: string, force = false) {
        this.#root = resolve(root); this.#path = join(root, ".cache", "sources.json")
        let head = ""
        try { head = git(root, ["rev-parse", "HEAD"]) } catch { /* non-Git authored sites work too */ }
        let old: Manifest | null = null
        try {
            const value = JSON.parse(readFileSync(this.#path, "utf8")) as Manifest
            if (value.version === 1 && value.root === this.#root && value.parser === parser_revision && value.files && typeof value.files === "object" && !Array.isArray(value.files)) old = value
        } catch { /* missing/corrupt cache triggers a complete scan */ }
        if (old && old.head !== head) {
            if (old.head && head) {
                try {
                    const top = git(root, ["rev-parse", "--show-toplevel"])
                    const files = execFileSync("git", ["-C", top, "diff", "--name-only", "--no-renames", "-z", old.head, head, "--"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000, maxBuffer: 8 * 1024 * 1024, windowsHide: true })
                    for (const file of files.split("\0").filter(Boolean)) this.#changed.add(resolve(top, file))
                } catch { this.#invalidate = true }
            } else this.#invalidate = true
        }
        this.#invalidate ||= force
        this.#data = { version: 1, root: this.#root, head, parser: parser_revision, compiled_at: new Date().toISOString(), files: old?.files ?? {} }
    }
    #key(file: string): string { return relative(this.#root, resolve(file)).replace(/\\/g, "/") }
    #entry(file: string): Entry {
        const key = this.#key(file), signature = stamp(file), previous = this.#data.files[key]
        if ((this.#seen.has(key) || !this.#invalidate && !this.#changed.has(resolve(file))) && previous?.stamp === signature) return previous
        this.#seen.add(key)
        const entry = { stamp: signature }
        this.#data.files[key] = entry
        return entry
    }
    xml(file: string): xml_node[] {
        const entry = this.#entry(file)
        if (entry.tree) {
            try {
                const roots: xml_node[] = JSON.parse(entry.tree)
                const restore = (node: xml_node, parent: xml_node | null, depth: number): void => {
                    if (!node || depth > 512 || typeof node.tag !== "string" || typeof node.text !== "string" || !Number.isInteger(node.line) || !node.attrs || typeof node.attrs !== "object" || Array.isArray(node.attrs) || !Object.values(node.attrs).every(value => typeof value === "string") || !Array.isArray(node.children)) throw new Error("Invalid cached XML")
                    node.file = file; node.parent = parent
                    node.children.forEach(child => restore(child, node, depth + 1))
                }
                if (!Array.isArray(roots)) throw new Error("Invalid cached XML")
                roots.forEach(node => restore(node, null, 0))
                this.stats.reused++; return roots
            } catch { delete entry.tree }
        }
        const roots = parse_xml(readFileSync(file, "utf8"), file)
        this.stats.parsed++
        // Keep cache trees detached from the mutable model and ignore a concurrent editor save.
        if (entry.stamp === stamp(file)) {
            const detach = (node: xml_node): unknown => ({ tag: node.tag, attrs: node.attrs, text: node.text, line: node.line, children: node.children.map(detach) })
            entry.tree = JSON.stringify(roots.map(detach))
        }
        return roots
    }
    hash(file: string): string {
        const entry = this.#entry(file)
        if (entry.hash && /^[a-f0-9]{64}$/.test(entry.hash)) { this.stats.hash_reused++; return entry.hash }
        const digest = createHash("sha256").update(readFileSync(file)).digest("hex")
        this.stats.hashed++
        if (entry.stamp === stamp(file)) entry.hash = digest
        return digest
    }
    tree(directory: string): string {
        const digest = createHash("sha256")
        const visit = (dir: string) => {
            for (const item of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
                if (item.name.startsWith(".") || ["node_modules", "dist", "test", "user_data"].includes(item.name) || item.isSymbolicLink()) continue
                const file = join(dir, item.name)
                if (item.isDirectory()) visit(file)
                else if (item.isFile()) digest.update(this.#key(file)).update("\0").update(this.hash(file)).update("\0")
            }
        }
        if (existsSync(directory)) visit(directory)
        return digest.digest("hex")
    }
    save(): void {
        for (const key of Object.keys(this.#data.files)) if (!existsSync(resolve(this.#root, key))) delete this.#data.files[key]
        const temporary = `${this.#path}.${randomUUID()}.tmp`
        try {
            mkdirSync(dirname(this.#path), { recursive: true })
            writeFileSync(temporary, JSON.stringify(this.#data))
            renameSync(temporary, this.#path)
        } catch { /* read-only source trees can always build without a cache */ }
        finally { try { unlinkSync(temporary) } catch {} }
    }
}
