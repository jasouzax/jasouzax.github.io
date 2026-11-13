/*
 * Google OIDC authorization-code flow: one-use browser-bound state, PKCE and nonce.
 * jose validates Google's RS256 signatures, issuer, audience and expiry against pinned Google JWKS.
 * Opaque HttpOnly sessions contain no provider tokens; admin bootstrap pins the configured email's immutable subject.
 */
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose"
import type { Work_Env } from "./work.ts"
import { api_error } from "./security.ts"
import { encode_key } from "../work_crypto.ts"

const session_cookie = "__Host-jazu_session"
const flow_cookie = "__Host-jazu_oauth"
const month = 30 * 86400000
const callback_path = "/api/v1/auth/google/callback"
const google_keys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"))
type Identity = { subject: string, email: string, name: string }
export type Auth_Session = Identity & { role: "owner" | "client", csrf: string }
export type Auth_Dependencies = { fetch?: typeof fetch, keys?: JWTVerifyGetKey }
const random = () => encode_key(crypto.getRandomValues(new Uint8Array(32)))
const cookie = (name: string, value: string, seconds: number) => `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${seconds}`
const reply = (data: unknown) => Response.json(data, { headers: { "cache-control": "no-store", "referrer-policy": "no-referrer", vary: "Cookie" } })

export async function auth_hash(value: string): Promise<string> {
    return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, "0")).join("")
}

function read_cookie(request: Request, name: string): string {
    const values = (request.headers.get("cookie") ?? "").split(";").map(value => value.trim()).filter(value => value.startsWith(name + "="))
    if (values.length !== 1) return ""
    const value = values[0].slice(name.length + 1)
    return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : ""
}

export async function read_session(request: Request, env: Work_Env): Promise<Auth_Session | null> {
    const token = read_cookie(request, session_cookie)
    if (!token || !env.DB) return null
    const hash = await auth_hash(token)
    const row = await env.DB.prepare("SELECT u.subject, u.email, u.name, s.last_seen, o.subject AS owner_subject FROM auth_sessions s JOIN auth_users u ON u.subject = s.subject LEFT JOIN auth_owner o ON o.subject = u.subject WHERE s.token_hash = ? AND s.last_seen > ?").bind(hash, Date.now() - month).first<Identity & { last_seen: number, owner_subject: string | null }>()
    if (!row) return null
    if (row.last_seen < Date.now() - 300000) await env.DB.prepare("UPDATE auth_sessions SET last_seen = ? WHERE token_hash = ?").bind(Date.now(), hash).run()
    return { subject: row.subject, email: row.email, name: row.name, role: row.owner_subject ? "owner" : "client", csrf: await auth_hash(`csrf\n${token}`) }
}

export function valid_csrf(request: Request, session: Auth_Session): boolean {
    return request.headers.get("origin") === new URL(request.url).origin && request.headers.get("x-jazu-csrf") === session.csrf && request.headers.get("x-jazu-work") === "1"
}

function redirect_work(error?: string): Response {
    return new Response(null, { status: 303, headers: { location: `/work${error ? `?auth_error=${error}` : ""}`, "cache-control": "no-store", "referrer-policy": "no-referrer", "set-cookie": cookie(flow_cookie, "", 0) } })
}

export async function verify_google_token(token: string, client: string, nonce: string, keys: JWTVerifyGetKey = google_keys): Promise<Identity> {
    const { payload } = await jwtVerify(token, keys, { algorithms: ["RS256"], issuer: ["https://accounts.google.com", "accounts.google.com"], audience: client, requiredClaims: ["exp", "iat", "sub", "email", "email_verified", "nonce"], maxTokenAge: "10 minutes", clockTolerance: 30 })
    if (payload.nonce !== nonce || payload.email_verified !== true || typeof payload.sub !== "string" || !payload.sub || payload.sub.length > 255 || typeof payload.email !== "string" || payload.email.length > 254 || !payload.email.includes("@") || (payload.azp !== undefined && payload.azp !== client)) throw new Error("Invalid Google identity")
    return { subject: payload.sub, email: payload.email.toLowerCase(), name: typeof payload.name === "string" ? payload.name.slice(0, 200) : payload.email }
}

export async function auth_route(request: Request, env: Work_Env, dependencies: Auth_Dependencies = {}): Promise<Response> {
    const url = new URL(request.url)
    if (!env.DB) return api_error("auth_unconfigured", "Sign-in is not configured", 503)
    if (url.pathname === "/api/v1/auth/session" && request.method === "GET") {
        const session = await read_session(request, env)
        const response = reply({ user: session ? { email: session.email, name: session.name, role: session.role } : null, csrf: session?.csrf ?? "", google_enabled: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_ADMIN_EMAIL) })
        const token = read_cookie(request, session_cookie)
        if (session && token) response.headers.set("set-cookie", cookie(session_cookie, token, month / 1000))
        return response
    }
    if (url.pathname === "/api/v1/auth/logout" && request.method === "POST") {
        const session = await read_session(request, env)
        if (!session || !valid_csrf(request, session)) return api_error("forbidden", "Invalid sign-out request", 403)
        await env.DB.prepare("DELETE FROM auth_sessions WHERE token_hash = ?").bind(await auth_hash(read_cookie(request, session_cookie))).run()
        const response = reply({ signed_out: true })
        response.headers.set("set-cookie", cookie(session_cookie, "", 0))
        return response
    }
    if (url.pathname === "/api/v1/auth/account/delete" && request.method === "POST") {
        const session = await read_session(request, env)
        if (!session || !valid_csrf(request, session) || request.headers.get("x-jazu-confirm-delete") !== "account") return api_error("forbidden", "Confirm account deletion from the signed-in account menu", 403)
        if (!env.DB.batch) return api_error("unavailable", "Account deletion is temporarily unavailable", 503)
        // A single transaction revokes every device and invitation while preserving the other participant's encrypted history.
        await env.DB.batch([
            env.DB.prepare("UPDATE work_rooms SET revoked = 1, token_hash = 'deleted:' || id, email = 'deleted-' || id || '@deleted.invalid', google_subject = NULL WHERE google_subject = ?").bind(session.subject),
            env.DB.prepare("DELETE FROM auth_sessions WHERE subject = ?").bind(session.subject),
            env.DB.prepare("DELETE FROM auth_owner WHERE subject = ?").bind(session.subject),
            env.DB.prepare("DELETE FROM auth_users WHERE subject = ?").bind(session.subject),
        ])
        const response = reply({ deleted: true })
        response.headers.set("set-cookie", cookie(session_cookie, "", 0))
        return response
    }
    if (request.method !== "GET") return api_error("method_not_allowed", "Use GET", 405)
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_ADMIN_EMAIL) return api_error("auth_unconfigured", "Google sign-in is not configured", 503)
    const redirect_uri = `${url.origin}${callback_path}`
    if (url.pathname === "/api/v1/auth/google/start") {
        if (request.headers.has("origin") && request.headers.get("origin") !== url.origin) return api_error("forbidden", "Use this site's sign-in button", 403)
        const state = random(), browser = random(), nonce = random(), verifier = random()
        await env.DB.prepare("DELETE FROM auth_flows WHERE expires_at < ?").bind(Date.now()).run()
        await env.DB.prepare("DELETE FROM auth_sessions WHERE last_seen < ?").bind(Date.now() - month).run()
        await env.DB.prepare("INSERT INTO auth_flows (state_hash, browser_hash, nonce, verifier, expires_at) VALUES (?, ?, ?, ?, ?)").bind(await auth_hash(state), await auth_hash(browser), nonce, verifier, Date.now() + 600000).run()
        const challenge = encode_key(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))))
        const query = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri, response_type: "code", scope: "openid email profile", state, nonce, code_challenge: challenge, code_challenge_method: "S256", prompt: "select_account" })
        return new Response(null, { status: 302, headers: { location: `https://accounts.google.com/o/oauth2/v2/auth?${query}`, "set-cookie": cookie(flow_cookie, browser, 600), "cache-control": "no-store", "referrer-policy": "no-referrer" } })
    }
    if (url.pathname !== callback_path) return api_error("not_found", "Unknown authentication route", 404)
    const state = url.searchParams.get("state") ?? "", browser = read_cookie(request, flow_cookie)
    if (!/^[A-Za-z0-9_-]{43}$/.test(state) || !browser) return redirect_work("invalid_state")
    const flow = await env.DB.prepare("DELETE FROM auth_flows WHERE state_hash = ? AND browser_hash = ? AND expires_at > ? RETURNING nonce, verifier").bind(await auth_hash(state), await auth_hash(browser), Date.now()).first<{ nonce: string, verifier: string }>()
    if (!flow) return redirect_work("invalid_state")
    if (url.searchParams.has("error")) return redirect_work(url.searchParams.get("error") === "access_denied" ? "cancelled" : "provider_error")
    const code = url.searchParams.get("code") ?? ""
    if (!code || code.length > 4096) return redirect_work("invalid_response")
    let identity: Identity
    try {
        const response = await (dependencies.fetch ?? fetch)("https://oauth2.googleapis.com/token", { method: "POST", redirect: "error", signal: AbortSignal.timeout(10000), headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri, grant_type: "authorization_code", code_verifier: flow.verifier }) })
        const result = await response.json() as { id_token?: string, error?: string }
        if (!response.ok || !result.id_token) return redirect_work(result.error === "invalid_client" ? "client_configuration" : "token_exchange")
        identity = await verify_google_token(result.id_token, env.GOOGLE_CLIENT_ID, flow.nonce, dependencies.keys)
    } catch { return redirect_work("identity_verification") }
    const now = Date.now()
    await env.DB.prepare("INSERT INTO auth_users (subject, email, name, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(subject) DO UPDATE SET email = excluded.email, name = excluded.name").bind(identity.subject, identity.email, identity.name, now).run()
    if (identity.email === env.GOOGLE_ADMIN_EMAIL.toLowerCase()) await env.DB.prepare("INSERT OR IGNORE INTO auth_owner (id, subject) VALUES (1, ?)").bind(identity.subject).run()
    const token = random()
    await env.DB.prepare("INSERT INTO auth_sessions (token_hash, subject, created_at, last_seen) VALUES (?, ?, ?, ?)").bind(await auth_hash(token), identity.subject, now, now).run()
    const previous = read_cookie(request, session_cookie)
    if (previous) await env.DB.prepare("DELETE FROM auth_sessions WHERE token_hash = ?").bind(await auth_hash(previous)).run()
    const response = redirect_work()
    response.headers.append("set-cookie", cookie(session_cookie, token, month / 1000))
    return response
}
