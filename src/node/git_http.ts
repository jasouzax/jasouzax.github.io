/*
 * Git smart-HTTP transport of the personal node (push, and clone of private repositories).
 *
 * Entities:
 *   git_route                  `/git-http/{id}.git/(info/refs|git-upload-pack|git-receive-pack)` as sent by the Worker
 *   make_throttle(...)         failure counter per key; blocks guessing of tokens
 *   parse_basic(header)        `Authorization: Basic` -> { user, token }
 *   authorize(...)             decision: 401 challenge | 403 | 404 | allowed with role
 *   parse_cgi(buffer)          splits a CGI response into status, headers and the start of the body
 *   handle_git_http(...)       runs `git http-backend` as a CGI process and streams both directions
 *
 * Scope:
 *   Reached only after the HMAC check in personal.ts (Worker -> Tunnel -> Access), so the caller is the Worker.
 *   Token auth decides *who pushed*; the pre-receive hook then decides *what* they may push.
 *   Public clones use this backend when their external Git provider is missing/unavailable. Request bodies are streamed,
 *   capped at `max_body`, and never buffered in memory. No arbitrary git command can be reached: the CGI
 *   program is fixed and PATH_INFO is built from a validated project id and one of three fixed operations.
 */
import { spawn } from "node:child_process"
import { existsSync, mkdirSync } from "node:fs"
import type { IncomingMessage, ServerResponse } from "node:http"
import { basename, dirname, join } from "node:path"
import { can, is_active, is_public, repository_path, verify_token } from "./server_config.ts"
import type { Action, Role, Server_Config } from "./server_config.ts"

export const git_route = /^\/git-http\/([a-z0-9_-]+)\.git\/(info\/refs|git-upload-pack|git-receive-pack)$/
const max_body = 512 * 1024 * 1024
const cgi_timeout_ms = 10 * 60_000
const challenge = { "www-authenticate": 'Basic realm="jazu git", charset="UTF-8"' }

export type Throttle = { blocked(key: string): boolean, fail(key: string): void, clear(key: string): void }
export type Decision = { status: 200, user: string, role: Role | "anonymous" } | { status: 401 | 403 | 404 | 429, message: string }

export function make_throttle(limit = 8, window_ms = 60_000, now = () => Date.now()): Throttle {
    const failures = new Map<string, number[]>()
    const recent = (key: string) => (failures.get(key) ?? []).filter(time => now() - time < window_ms)
    return {
        blocked: key => recent(key).length >= limit,
        fail: key => { failures.set(key, [...recent(key), now()]) },
        clear: key => { failures.delete(key) },
    }
}

export function parse_basic(header: string | undefined): { user: string, token: string } | null {
    const match = /^Basic\s+([A-Za-z0-9+/=]+)$/.exec(header ?? "")
    if (!match) return null
    const text = Buffer.from(match[1], "base64").toString("utf8")
    const colon = text.indexOf(":")
    return colon > 0 ? { user: text.slice(0, colon).toLowerCase(), token: text.slice(colon + 1) } : null
}

export function service_of(operation: string, search: URLSearchParams): string | null {
    const service = operation === "info/refs" ? search.get("service") : operation
    return service === "git-upload-pack" || service === "git-receive-pack" ? service : null
}

export function authorize(config: Server_Config, throttle: Throttle, id: string, service: string, authorization: string | undefined): Decision {
    const action: Action = service === "git-receive-pack" ? "write" : "read"
    if (!existsSync(join(repository_path(config, id), "HEAD"))) return { status: 404, message: "Unknown repository" }
    if (action === "read" && is_public(config, id)) return { status: 200, user: "anonymous", role: "anonymous" }
    const credentials = parse_basic(authorization)
    if (!credentials) return { status: 401, message: "Credentials required" }
    if (throttle.blocked(credentials.user) || throttle.blocked("*")) return { status: 429, message: "Too many failed attempts; wait a minute" }
    const role = verify_token(config, credentials.user, credentials.token)
    if (!role) {
        throttle.fail(credentials.user)
        throttle.fail("*")
        return { status: 401, message: "Invalid credentials" }
    }
    throttle.clear(credentials.user)
    if (!can(role, action)) return { status: 403, message: "This token cannot write" }
    if (action === "write" && !is_active(config, id)) return { status: 403, message: `${id} is archived and no longer accepts pushes` }
    return { status: 200, user: credentials.user, role }
}

// CGI output is `Header: value` lines, a blank line, then the body; `Status:` carries the HTTP status.
export function parse_cgi(buffer: Buffer): { status: number, headers: Record<string, string>, body: Buffer } | null {
    const crlf = buffer.indexOf("\r\n\r\n")
    const lf = buffer.indexOf("\n\n")
    const end = crlf >= 0 && (lf < 0 || crlf < lf) ? crlf : lf
    if (end < 0) return null
    const gap = end === crlf ? 4 : 2
    let status = 200
    const headers: Record<string, string> = {}
    for (const line of buffer.subarray(0, end).toString("utf8").split(/\r?\n/)) {
        const colon = line.indexOf(":")
        if (colon <= 0) continue
        const name = line.slice(0, colon).trim().toLowerCase()
        const value = line.slice(colon + 1).trim()
        if (name === "status") status = Number.parseInt(value, 10) || 200
        else headers[name] = value
    }
    return { status, headers, body: buffer.subarray(end + gap) }
}

function reply(outgoing: ServerResponse, status: number, message: string, extra: Record<string, string> = {}): void {
    outgoing.writeHead(status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...extra })
    outgoing.end(`${message}\n`)
}

function cgi_environment(config: Server_Config, id: string, operation: string, incoming: IncomingMessage, url: URL, decision: { user: string, role: string }): NodeJS.ProcessEnv {
    const repository = repository_path(config, id)
    const home = join(config.state_dir, "home")
    mkdirSync(home, { recursive: true })
    const header = (name: string) => String(incoming.headers[name] ?? "")
    const settings = [["http.receivepack", "true"], ["uploadpack.allowFilter", "true"], ["uploadpack.hideRefs", "refs/jazu-sync"], ["uploadpack.hideRefs", "refs/remotes"]]
    const git_config = Object.fromEntries(settings.flatMap(([key, value], index) => [[`GIT_CONFIG_KEY_${index}`, key], [`GIT_CONFIG_VALUE_${index}`, value]]))
    return {
        PATH: process.env.PATH, HOME: home, GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_COUNT: String(settings.length), ...git_config,
        GIT_PROJECT_ROOT: dirname(repository), GIT_HTTP_EXPORT_ALL: "1",
        PATH_INFO: `/${basename(repository)}/${operation}`, REQUEST_METHOD: incoming.method, QUERY_STRING: url.search.slice(1),
        CONTENT_TYPE: header("content-type"), CONTENT_LENGTH: header("content-length"),
        HTTP_CONTENT_ENCODING: header("content-encoding"), HTTP_GIT_PROTOCOL: header("git-protocol"),
        REMOTE_USER: decision.user, REMOTE_ADDR: "127.0.0.1",
        GIT_COMMITTER_NAME: decision.user, GIT_COMMITTER_EMAIL: `${decision.user}@jazu.invalid`,
        JAZU_USER: decision.user, JAZU_ROLE: decision.role === "anonymous" ? "" : decision.role, JAZU_PROJECT: id, JAZU_SERVER_CONFIG: config.file,
    }
}

export function handle_git_http(incoming: IncomingMessage, outgoing: ServerResponse, url: URL, config: Server_Config, throttle: Throttle): void {
    const match = git_route.exec(url.pathname)
    if (!match) return reply(outgoing, 404, "Unknown route")
    const [, id, operation] = match
    const service = service_of(operation, url.searchParams)
    const expected = operation === "info/refs" ? "GET" : "POST"
    if (!service) return reply(outgoing, 400, "Only the smart protocol is served here")
    if (incoming.method !== expected) return reply(outgoing, 405, `Use ${expected}`, { allow: expected })
    const decision = authorize(config, throttle, id, service, incoming.headers.authorization)
    if (decision.status !== 200) return reply(outgoing, decision.status, decision.message, decision.status === 401 ? challenge : decision.status === 429 ? { "retry-after": "60" } : {})
    const child = spawn("git", ["http-backend"], { env: cgi_environment(config, id, operation, incoming, url, decision), stdio: ["pipe", "pipe", "pipe"], windowsHide: true })
    const timer = setTimeout(() => child.kill("SIGKILL"), cgi_timeout_ms)
    let head = Buffer.alloc(0)
    let started = false
    let received = 0
    let error_text = ""
    child.stderr.on("data", chunk => { if (error_text.length < 4000) error_text += chunk.toString("utf8") })
    child.stdin.on("error", () => { /* backend exited early; the close handler reports it */ })
    // pipe() gives backpressure; the extra listener only counts bytes for the size cap.
    incoming.pipe(child.stdin)
    incoming.on("data", chunk => {
        received += chunk.length
        if (received <= max_body) return
        child.kill("SIGKILL")
        if (!started) reply(outgoing, 413, "Push is larger than the 512 MiB limit")
        started = true
    })
    incoming.on("error", () => child.kill("SIGKILL"))
    outgoing.on("close", () => { if (child.exitCode === null) child.kill("SIGKILL") })
    child.stdout.on("data", (chunk: Buffer) => {
        if (started) { outgoing.write(chunk); return }
        head = Buffer.concat([head, chunk])
        const parsed = parse_cgi(head)
        if (!parsed) return
        started = true
        outgoing.writeHead(parsed.status, { "cache-control": "no-store", ...parsed.headers })
        if (parsed.body.length) outgoing.write(parsed.body)
    })
    child.on("close", code => {
        clearTimeout(timer)
        if (!started) {
            console.error(`git http-backend failed (${code}) for ${id}: ${error_text.trim().slice(0, 300)}`)
            reply(outgoing, 500, "Git backend failed")
        } else outgoing.end()
    })
}
