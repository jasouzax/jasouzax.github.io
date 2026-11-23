/* Coordinate host, repository, API and static asset routing; fail closed on invalid requests. */
import { catalog_projects, host_route } from "./host.ts"
import { static_object } from "./assets.ts"
import { api_route } from "./api.ts"
import { valid_subdomain_id } from "../../shared/content/ids.ts"
import { api_error, secure_response, is_work_path } from "../security/headers.ts"
import { repository_route } from "../repo/front.ts"
import { type Work_Env } from "../api/work.ts"
import { type Server_Env } from "../api/server.ts"
import { render_server_page, server_page_path } from "../render/page.ts"
export { Realtime_Hub } from "../room/room.ts"
export { Server_Hub } from "../hub/hub.ts"

type object_result = {
    body?: ReadableStream<Uint8Array>
    httpEtag: string
    size: number
    range?: { offset: number, length: number }
    writeHttpMetadata(headers: Headers): void
}
export type worker_env = Work_Env & Server_Env & {
    DOMAIN: string
    PAGES_ORIGIN: string
    PUBLIC_PROJECTS?: string
    PUBLIC_PROJECTS_MANIFEST?: string
    PROJECT_CLONE_ORIGINS?: string
    PERSONAL_ORIGIN?: string
    ORIGIN_HMAC_SECRET?: string
    ACCESS_CLIENT_ID?: string
    ACCESS_CLIENT_SECRET?: string
    ASSETS?: { get(key: string, options?: { range: Headers, onlyIf: Headers }): Promise<object_result | null> }
    REGISTRY?: { get(key: string): Promise<string | null> }
}
type fetcher = (request: Request) => Promise<Response>
// Oversized website assets and Git packs share the static R2 transport, including ranges and conditional reads.

export async function route(request: Request, env: worker_env, upstream: fetcher = fetch): Promise<Response> {
    const url = new URL(request.url)
    let path: string
    try { path = decodeURIComponent(url.pathname) } catch { return api_error("bad_path", "Invalid URL encoding", 400) }
    if (path.includes("\\") || path.includes("\0") || path.split("/").some(part => part === ".." || part.startsWith("."))) {
        // RFC security contact is the one public dot-directory endpoint.
        if (path !== "/.well-known/security.txt") return api_error("bad_path", "Invalid path", 400)
    }
    const projects: string[] = JSON.parse(env.PUBLIC_PROJECTS ?? "[]").filter(valid_subdomain_id)
    const candidate = /^\/(?:projects\/([a-z0-9_-]+)(?:\.git)?\/|api\/_\/(?:git|ci)\/([a-z0-9_-]+)(?:\/|$))/.exec(path)
    const subdomain = url.hostname.endsWith(`.${env.DOMAIN}`) ? url.hostname.slice(0, -(env.DOMAIN.length + 1)) : undefined
    const requested_project = subdomain === "repo" ? path.split("/")[1] : candidate?.[1] ?? candidate?.[2] ?? subdomain
    if (requested_project && !projects.includes(requested_project)) projects.push(...await catalog_projects(request, env, upstream))
    if (url.hostname === `repo.${env.DOMAIN}`) return repository_route(request, env, projects, upstream)
    const host = await host_route(request, env, projects, upstream)
    if (host) return host
    if (/^\/projects\/[^/]+(?:\.git)?\/(?:HEAD|info|objects|git-|_git)/.test(path)) return api_error("not_found", "Use the repository host", 404)
    if (path === "/api" || path.startsWith("/api/")) return api_route(request, env)
    if (!["GET", "HEAD"].includes(request.method)) return api_error("method_not_allowed", "Static routes allow GET and HEAD", 405)
    if (path.startsWith("/assets/media/") || path.startsWith("/assets/wasm/")) {
        const response = await static_object(request, env, path.slice(1))
        if (response) return response
    }
    const pages = new URL(env.PAGES_ORIGIN)
    if (pages.origin === url.origin || pages.origin !== env.PAGES_ORIGIN || (pages.protocol !== "https:" && pages.hostname !== "127.0.0.1")) return api_error("bad_origin", "Configure a distinct Pages HTTPS origin", 503)
    // Only public request headers are forwarded to Pages; UUID query secrets never reach it.
    const target = new URL(is_work_path(path) ? url.pathname : url.pathname + url.search, pages)
    const headers = new Headers()
    const dynamic_page = server_page_path(path)
    for (const name of ["accept", "accept-encoding", "range", "if-none-match", "if-modified-since"]) {
        if (dynamic_page && ["range", "if-none-match", "if-modified-since"].includes(name)) continue
        if (request.headers.has(name)) headers.set(name, request.headers.get(name)!)
    }
    const response = await upstream(new Request(target, { method: dynamic_page && request.method === "HEAD" ? "GET" : request.method, headers, redirect: "manual" }))
    return dynamic_page ? render_server_page(request, response, env.SERVER_HUB) : response
}

export default {
    async fetch(request: Request, env: worker_env): Promise<Response> {
        const path = new URL(request.url).pathname
        const private_response = is_work_path(path) || path === "/api/_/session" || path.startsWith("/api/_/auth/")
        try { const response = await route(request, env); return response.status === 101 ? response : secure_response(response, private_response) }
        catch { return secure_response(api_error("unavailable", "Service temporarily unavailable", 503), private_response) }
    },
}
