import * as fs from "node:fs"
import * as path from "node:path"

// Desired running state, stored separately from logs and browser profiles.
export class Auto_Start {
    readonly #file: string
    #scripts = new Set<string>()
    constructor(file: string) {
        this.#file = file
        if (!fs.existsSync(file)) return
        const saved = JSON.parse(fs.readFileSync(file, "utf8"))
        if (saved.version !== 1 || !Array.isArray(saved.scripts) || saved.scripts.some((item: unknown) => typeof item !== "string" || !path.isAbsolute(item) || !item.endsWith(".auto.js") || item.includes("\0"))) throw new Error("Invalid automation restart list")
        this.#scripts = new Set(saved.scripts)
    }
    list(): string[] { return [...this.#scripts].sort() }
    has(script: string): boolean { return this.#scripts.has(script) }
    set(script: string, enabled: boolean): void {
        if (!path.isAbsolute(script) || !script.endsWith(".auto.js") || script.includes("\0")) throw new Error("Automation path must be absolute and end in .auto.js")
        if (this.has(script) === enabled) return
        const next = new Set(this.#scripts)
        if (enabled) next.add(script); else next.delete(script)
        const folder = path.dirname(this.#file)
        fs.mkdirSync(folder, { recursive: true, mode: 0o700 })
        const temporary = this.#file + ".tmp"
        const fd = fs.openSync(temporary, "w", 0o600)
        try { fs.writeFileSync(fd, JSON.stringify({ version: 1, scripts: [...next].sort() }) + "\n"); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
        fs.renameSync(temporary, this.#file)
        if (process.platform !== "win32") {
            const directory = fs.openSync(folder, "r")
            try { fs.fsyncSync(directory) } finally { fs.closeSync(directory) }
        }
        this.#scripts = next
    }
}
