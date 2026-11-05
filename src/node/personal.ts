import { createServer } from "node:http"
import { execFileSync } from "node:child_process"
import { resolve } from "node:path"
import { api_error, verify_origin } from "./security.ts"

export type personal_options = { secret: string, repositories: Record<string, string>, port: number }

export function git_read(repository: string, action: string, url: URL): Response {
    const ref = url.searchParams.get("ref") ?? "HEAD"
    const path = url.searchParams.get("path") ?? ""
    if (!/^[a-zA-Z0-9_][a-zA-Z0-9_./-]*$/.test(ref) || ref.includes("..") || path.startsWith("/") || path.includes("\\") || path.split("/").includes("..") || path.includes("\0")) return api_error("bad_ref", "Invalid ref or path", 400)
    const git = (args: string[], maxBuffer = 2 * 1024 * 1024) => execFileSync("git", ["-C", resolve(repository), ...args], { maxBuffer, windowsHide: true })
    try {
        if (action === "refs") {
            const refs = git(["for-each-ref", "--format=%(refname)%00%(objectname)", "refs/heads", "refs/tags"]).toString("utf8").trim().split("\n").filter(Boolean).map(line => {
                const [name, hash] = line.split("\0"); return { name, hash }
            })
            return Response.json({ refs })
        }
        if (action === "log") {
            const commits = git(["log", "-n", "100", "--format=%H%x00%ct%x00%s", ref, "--", ...(path ? [path] : [])]).toString("utf8").trim().split("\n").filter(Boolean).map(line => {
                const [id, timestamp, subject] = line.split("\0"); return { id, timestamp: Number(timestamp), subject }
            })
            return Response.json({ commits })
        }
        if (action === "tree") {
            const entries = git(["ls-tree", "-z", ref, "--", ...(path ? [path] : [])]).toString("utf8").split("\0").filter(Boolean).map(line => {
                const [metadata, name] = line.split("\t"); const [mode, kind, hash] = metadata.split(" "); return { name, mode, kind, hash }
            })
            return Response.json({ entries })
        }
        if (action === "blob" && path) {
            const data = git(["show", `${ref}:${path}`], 16 * 1024 * 1024)
            return new Response(new Uint8Array(data), { headers: { "content-type": "application/octet-stream", "x-content-type-options": "nosniff" } })
        }
        return api_error("not_found", "Unknown repository operation", 404)
    } catch { return api_error("not_found", "Repository resource unavailable or exceeds read limit", 404) }
}

export function personal_server(options: personal_options) {
    if (options.secret.length < 32) throw new Error("Set ORIGIN_HMAC_SECRET to at least 32 random characters")
    const seen = new Map<string, number>()
    return createServer(async (incoming, outgoing) => {
        try {
            const request = new Request(`http://127.0.0.1${incoming.url ?? "/"}`, { method: incoming.method, headers: incoming.headers as Record<string, string> })
            let response: Response
            if (request.method !== "GET" || !await verify_origin(request, options.secret, seen)) response = api_error("unauthorized", "Signed GET request required", 401)
            else {
                const url = new URL(request.url)
                const match = /^\/git\/([a-z0-9_-]+)\/(refs|tree|blob|log)$/.exec(url.pathname)
                if (url.pathname === "/health") response = Response.json({ status: "ok", generation: 12 })
                else if (match && Object.hasOwn(options.repositories, match[1])) response = git_read(options.repositories[match[1]], match[2], url)
                else response = api_error("not_found", "Unknown repository or route", 404)
            }
            outgoing.writeHead(response.status, Object.fromEntries(response.headers))
            outgoing.end(new Uint8Array(await response.arrayBuffer()))
        } catch {
            outgoing.writeHead(500, { "content-type": "application/json", "cache-control": "no-store" })
            outgoing.end(JSON.stringify({ error: { code: "internal", message: "Personal node failed" } }))
        }
    }).listen(options.port, "127.0.0.1", () => console.log(`personal node listening on 127.0.0.1:${options.port}`))
}
