import { createServer } from "node:http"
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs"
import { join, extname, resolve } from "node:path"
import { inside } from "../paths.ts"
import { is_work_path } from "./security.ts"

const types: Record<string, string> = {
    ".wasm": "application/wasm",
    ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript", ".cjs": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml",
    ".woff2": "font/woff2", ".woff": "font/woff", ".png": "image/png", ".jpg": "image/jpeg", ".mp4": "video/mp4", ".xml": "application/xml", ".txt": "text/plain; charset=utf-8", ".avif": "image/avif", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json", ".md": "text/markdown; charset=utf-8",
    ".zip": "application/zip", ".whl": "application/octet-stream", ".map": "application/json",
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

export function serve(out: string, port: number, host = "127.0.0.1") {
    return createServer((request, response) => {
        if (!["GET", "HEAD"].includes(request.method ?? "GET")) { response.writeHead(405, { allow: "GET, HEAD" }); response.end(); return }
        if ((request.url ?? "").split("?")[0] === "/api/v1/health") {
            response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" })
            response.end(request.method === "HEAD" ? undefined : JSON.stringify({ status: "ok", role: "website" }))
            return
        }
        const file = resolve_request(out, request.url ?? "/")
        if (!file || !existsSync(file)) {
            const missing = join(out, "404.html")
            response.writeHead(404, { "content-type": types[".html"] })
            response.end(existsSync(missing) ? readFileSync(missing) : "Not found")
            return
        }
        const work = is_work_path(new URL(request.url ?? "/", "http://localhost").pathname)
        const size = statSync(file).size
        let start = 0, end = size - 1, status = 200
        const range = request.headers.range
        if (range) {
            const match = /^bytes=(\d*)-(\d*)$/.exec(range)
            if (!match || (!match[1] && !match[2])) { response.writeHead(416, { "content-range": `bytes */${size}` }); response.end(); return }
            start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]))
            end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1
            if (start > end || start >= size || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)) { response.writeHead(416, { "content-range": `bytes */${size}` }); response.end(); return }
            status = 206
        }
        response.writeHead(status, { "content-type": types[extname(file)] ?? "application/octet-stream", ...static_headers(out, new URL(request.url ?? "/", "http://localhost").pathname), "content-length": Math.max(0, end - start + 1), "accept-ranges": "bytes", ...(status === 206 ? { "content-range": `bytes ${start}-${end}/${size}` } : {}), "x-content-type-options": "nosniff", "referrer-policy": work ? "no-referrer" : "strict-origin-when-cross-origin", ...(work ? { "x-robots-tag": "noindex, nofollow", "cache-control": "no-store" } : {}) })
        if (request.method === "HEAD" || size === 0) response.end()
        else {
            const stream = createReadStream(file, { start, end })
            stream.on("error", () => response.destroy())
            response.on("close", () => stream.destroy())
            stream.pipe(response)
        }
    }).listen(port, host, () => console.log(`serving ${out} at http://${host}:${port}`))
}
