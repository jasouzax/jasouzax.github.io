import { createServer } from "node:http"
import type { IncomingMessage } from "node:http"
import { execFileSync } from "node:child_process"
import { resolve } from "node:path"
import { api_error } from "../../shared/http.ts"
import { verify_origin } from "../../shared/sign.ts"
import { git_route, handle_git_http, make_throttle } from "./git/http.ts"
import { list_runs } from "../pipeline/runner.ts"
import type { Server_Config } from "../config/repositories.ts"
import { is_active, is_public, repository_path } from "../config/repositories.ts"
import { pipeline_hook } from "../pipeline/hook.ts"
import { history_limit } from "../../shared/repo/history.ts"
import { public_status_route } from "../render/status.ts"
import type { Api_Manager } from "../api/manager.ts"
import { api_transport } from "../api/http.ts"

// `config` (server.json) enables smart-HTTP push and CI status; without it the node stays the read-only adapter it was.
export type personal_options = { secret: string, repositories: Record<string, string>, port: number, host?: string, config?: Server_Config, apis?: Api_Manager }

export function git_read(repository: string, action: string, url: URL): Response {
    const ref = url.searchParams.get("ref") ?? "HEAD"
    const path = url.searchParams.get("path") ?? ""
    if (!/^[a-zA-Z0-9_][a-zA-Z0-9_./-]*$/.test(ref) || ref.includes("..") || path.startsWith("/") || path.includes("\\") || path.split("/").includes("..") || path.includes("\0")) return api_error("bad_ref", "Invalid ref or path", 400)
    const git = (args: string[], maxBuffer = 2 * 1024 * 1024) => execFileSync("git", ["-C", resolve(repository), ...args], { maxBuffer, windowsHide: true })
    try {
        if (action === "refs") {
            const refs = git(["for-each-ref", "--format=%(refname)%00%(objectname)%00%(*objectname)", "refs/heads", "refs/tags"]).toString("utf8").trim().split("\n").filter(Boolean).map(line => {
                const [name, hash, peeled] = line.split("\0"); return { name, hash, commit: peeled || hash }
            })
            return Response.json({ refs })
        }
        if (action === "log") {
            const commits = git(["log", "--topo-order", "-n", String(history_limit), "--format=%H%x00%P%x00%ct%x00%s", ref, "--", ...(path ? [path] : [])]).toString("utf8").trim().split("\n").filter(Boolean).map(line => {
                const [id, parents, timestamp, subject] = line.split("\0"); return { id, parents: parents ? parents.split(" ") : [], timestamp: Number(timestamp), subject }
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

// Only the x-jazu-* headers take part in verification; everything else on the request is none of its business.
function signed_view(incoming: IncomingMessage): Request {
    const headers = new Headers()
    for (const name of ["x-jazu-time", "x-jazu-nonce", "x-jazu-client", "x-jazu-signature", "x-jazu-body"]) {
        const value = incoming.headers[name]
        if (typeof value === "string") headers.set(name, value)
    }
    return new Request(`http://127.0.0.1${incoming.url ?? "/"}`, { method: incoming.method, headers })
}

async function read_response(request: Request, options: personal_options): Promise<Response> {
    const url = new URL(request.url)
    const match = /^\/git\/([a-z0-9_-]+)\/(refs|tree|blob|log)$/.exec(url.pathname)
    const runs = /^\/ci\/([a-z0-9_-]+)\/runs$/.exec(url.pathname)
    if (url.pathname === "/health") return Response.json({ status: "ok", generation: 12 })
    const rendered = await public_status_route(request)
    if (rendered) return rendered
    if (match && options.config && (match[1] === options.config.site.project || Object.hasOwn(options.config.projects, match[1])) && is_public(options.config, match[1])) return git_read(repository_path(options.config, match[1]), match[2], url)
    if (match && !options.config && Object.hasOwn(options.repositories, match[1])) return git_read(options.repositories[match[1]], match[2], url)
    if (runs && options.config && is_active(options.config, runs[1]) && is_public(options.config, runs[1])) return Response.json({ runs: list_runs(options.config.state_dir, runs[1], 20, url.searchParams.get("branch") ?? undefined) })
    return api_error("not_found", "Unknown repository or route", 404)
}

export function personal_server(options: personal_options) {
    if (options.secret.length < 32) throw new Error("Set ORIGIN_HMAC_SECRET to at least 32 random characters")
    const seen = new Map<string, number>()
    const throttle = make_throttle()
    return createServer(async (incoming, outgoing) => {
        try {
            const request = signed_view(incoming)
            const url = new URL(request.url)
            if (url.pathname.startsWith("/custom-api/")) {
                const response = options.apis ? await api_transport(incoming, options.apis, options.secret, seen) : api_error("unavailable", "Custom API service is disabled", 503)
                outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(new Uint8Array(await response.arrayBuffer())); return
            }
            if (git_route.test(url.pathname)) {
                // Smart HTTP carries a streamed body, so it is the one route family that verifies the unsigned-stream mode.
                if (!options.config || !await verify_origin(request, options.secret, seen, Date.now(), true)) {
                    const denied = api_error("unauthorized", "Signed request required", 401)
                    outgoing.writeHead(denied.status, Object.fromEntries(denied.headers))
                    outgoing.end(await denied.text())
                    return
                }
                handle_git_http(incoming, outgoing, url, options.config, throttle)
                return
            }
            const hook = request.method === "POST" && url.pathname.startsWith("/projects/") && options.config && request.headers.get("x-jazu-client") === "pipeline"
            const verified = await verify_origin(request, options.secret, seen)
            const response = hook && verified
                ? pipeline_hook(url.pathname, options.config!)
                : request.method !== "GET" || !verified
                ? api_error("unauthorized", "Signed GET request required", 401)
                : await read_response(request, options)
            outgoing.writeHead(response.status, Object.fromEntries(response.headers))
            outgoing.end(new Uint8Array(await response.arrayBuffer()))
        } catch {
            outgoing.writeHead(500, { "content-type": "application/json", "cache-control": "no-store" })
            outgoing.end(JSON.stringify({ error: { code: "internal", message: "Personal node failed" } }))
        }
    }).listen(options.port, options.host ?? "127.0.0.1", () => console.log(`personal node listening on ${options.host ?? "127.0.0.1"}:${options.port}`))
}
