import { createServer } from "node:http"
import { existsSync, readFileSync, statSync } from "node:fs"
import { join, extname, resolve } from "node:path"
import { inside } from "../paths.ts"

const types: Record<string, string> = {
    ".wasm": "application/wasm",
    ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml",
    ".woff2": "font/woff2", ".woff": "font/woff", ".png": "image/png", ".jpg": "image/jpeg", ".mp4": "video/mp4", ".xml": "application/xml", ".txt": "text/plain; charset=utf-8", ".avif": "image/avif", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json", ".md": "text/markdown; charset=utf-8",
    ".zip": "application/zip", ".whl": "application/octet-stream",
}

function static_headers(out: string, path: string): Record<string, string> {
    const file = join(out, "_headers")
    if (!existsSync(file)) return {}
    const result: Record<string, string> = {}
    let matches = false
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
        if (!line.trim() || line.trim().startsWith("#")) continue
        if (!/^\s/.test(line)) {
            const pattern = line.trim().split("*").map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")
            matches = new RegExp(`^${pattern}$`).test(path)
        } else if (matches) {
            const colon = line.indexOf(":")
            if (colon > 0) result[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim()
        }
    }
    return result
}

export function resolve_request(out: string, url_path: string): string | null {
    let clean: string
    try { clean = decodeURIComponent(url_path.split("?")[0]) } catch { return null }
    if (clean.includes("\\") || clean.includes("\0") || clean.split("/").some(part => part === ".." || part.startsWith("."))) return null
    const direct = resolve(out, "." + (clean.startsWith("/") ? clean : "/" + clean))
    if (!inside(out, direct)) return null
    if (existsSync(direct) && statSync(direct).isFile()) return direct
    const index = join(out, clean, "index.html")
    if (existsSync(index)) return index
    return null
}

export function serve(out: string, port: number) {
    return createServer((request, response) => {
        const file = resolve_request(out, request.url ?? "/")
        if (!file || !existsSync(file)) {
            const missing = join(out, "404.html")
            response.writeHead(404, { "content-type": types[".html"] })
            response.end(existsSync(missing) ? readFileSync(missing) : "Not found")
            return
        }
        const work = new URL(request.url ?? "/", "http://localhost").pathname === "/work"
        response.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream", ...static_headers(out, new URL(request.url ?? "/", "http://localhost").pathname), "x-content-type-options": "nosniff", "referrer-policy": work ? "no-referrer" : "strict-origin-when-cross-origin", ...(work ? { "x-robots-tag": "noindex, nofollow", "cache-control": "no-store" } : {}) })
        response.end(request.method === "HEAD" ? undefined : readFileSync(file))
    }).listen(port, "127.0.0.1", () => console.log(`serving ${out} at http://127.0.0.1:${port}`))
}
