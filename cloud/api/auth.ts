/*
 * Google OIDC authorization-code flow: one-use browser-bound state, PKCE and nonce.
 * jose validates Google's RS256 signatures, issuer, audience and expiry against pinned Google JWKS.
 * Opaque HttpOnly sessions contain no provider tokens; admin bootstrap pins the configured email's immutable subject.
 */
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose"
import type { Work_Env } from "./work.ts"
import { api_error } from "../security/headers.ts"
import { encode_key } from "../../shared/work/crypto.ts"
import { google_access, save_google_grant } from "./auth/google.ts"
import { google_picture } from "../../shared/work/profile.ts"
import { realtime_revoke } from "../room/bus.ts"
import { work_changed } from "../room/work.ts"

import { session_route } from "./session.ts"
import { session_cookie, session_lifetime as month, cookie, read_cookie } from "./auth/cookies.ts"
import { access_cookie, issue_access } from "./auth/jwt.ts"
import { passkey_route, recent_auth } from "./auth/passkey.ts"
const flow_cookie = "__Host-jazu_oauth"
const callback_path = "/api/_/auth/google/callback"
const google_keys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"))
type Identity = { subject: string, email: string, name: string, picture?: string }
export type Auth_Session = Identity & { role: "owner" | "client", csrf: string, step_up?: boolean, passkey_pending?: boolean }
export type Auth_Dependencies = { fetch?: typeof fetch, keys?: JWTVerifyGetKey }
const random = () => encode_key(crypto.getRandomValues(new Uint8Array(32)))
const reply = (data: unknown) => Response.json(data, { headers: { "cache-control": "no-store", "referrer-policy": "no-referrer", vary: "Cookie" } })

export async function auth_hash(value: string): Promise<string> {
    return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, "0")).join("")
}

export const session_token = (request: Request) => read_cookie(request, session_cookie)

export async function read_session(request: Request, env: Work_Env): Promise<Auth_Session | null> {
    const token = read_cookie(request, session_cookie)
    if (!token || !env.DB) return null
    return read_session_hash(await auth_hash(token), env, await auth_hash(`csrf\n${token}`))
}

// Durable Objects already hold the refresh hash, never the raw cookie. They use the identical authority check.
export async function read_session_hash(hash: string, env: Work_Env, csrf: string): Promise<Auth_Session | null> {
    if (!env.DB) return null
    const row = await env.DB.prepare("SELECT u.subject, u.email, u.name, p.picture, s.last_seen, o.subject AS owner_subject, (SELECT count(*) FROM auth_passkeys k WHERE k.subject = u.subject) AS passkey_count, (SELECT verified_at FROM auth_stepups a WHERE a.session_hash = s.token_hash) AS stepup_verified FROM auth_sessions s JOIN auth_users u ON u.subject = s.subject LEFT JOIN auth_profiles p ON p.subject = u.subject LEFT JOIN auth_owner o ON o.subject = u.subject WHERE s.token_hash = ? AND s.last_seen > ?").bind(hash, Date.now() - month).first<Identity & { last_seen: number, owner_subject: string | null, passkey_count: number, stepup_verified: number | null }>()
    if (!row) return null
    if (row.last_seen < Date.now() - 300000) await env.DB.prepare("UPDATE auth_sessions SET last_seen = ? WHERE token_hash = ?").bind(Date.now(), hash).run()
    const pending = row.passkey_count > 0 && !row.stepup_verified, locked = !!row.owner_subject && pending
    return { subject: row.subject, email: row.email, name: row.name, picture: google_picture(row.picture), role: row.owner_subject && !locked ? "owner" : "client", csrf, ...(locked ? { step_up: true } : {}), ...(pending ? { passkey_pending: true } : {}) }
}

export function valid_csrf(request: Request, session: Auth_Session): boolean {
    return request.headers.get("origin") === new URL(request.url).origin && request.headers.get("x-jazu-csrf") === session.csrf && request.headers.get("x-jazu-work") === "1"
}

function finish_sign_in(error?: string): Response {
    const nonce = random()
    // This page carries no credentials. The original tab re-reads its HttpOnly session.
    const result = JSON.stringify({ type: "jazu:oauth", error: error || "" })
    const message = error ? "Sign-in was not completed. Return to the original window and try again." : "Signed in. You can close this window."
    const body = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Google sign-in</title><body><p>${message}</p><script nonce="${nonce}">const result=${result};try{window.opener?.postMessage(result,location.origin)}catch{}try{const channel=new BroadcastChannel("jazu:oauth");channel.postMessage(result);channel.close()}catch{}if(!result.error)window.close();</script></body></html>`
    return new Response(body, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer", "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; frame-ancestors 'none'; base-uri 'none'`, "cross-origin-opener-policy": "same-origin-allow-popups", "set-cookie": cookie(flow_cookie, "", 0) } })
}

export async function verify_google_token(token: string, client: string, nonce: string, keys: JWTVerifyGetKey = google_keys): Promise<Identity> {
    const { payload } = await jwtVerify(token, keys, { algorithms: ["RS256"], issuer: ["https://accounts.google.com", "accounts.google.com"], audience: client, requiredClaims: ["exp", "iat", "sub", "email", "email_verified", "nonce"], maxTokenAge: "10 minutes", clockTolerance: 30 })
    if (payload.nonce !== nonce || payload.email_verified !== true || typeof payload.sub !== "string" || !payload.sub || payload.sub.length > 255 || typeof payload.email !== "string" || payload.email.length > 254 || !payload.email.includes("@") || (payload.azp !== undefined && payload.azp !== client)) throw new Error("Invalid Google identity")
    return { subject: payload.sub, email: payload.email.toLowerCase(), name: typeof payload.name === "string" ? payload.name.slice(0, 200) : payload.email, picture: google_picture(payload.picture) }
}

export async function auth_route(request: Request, env: Work_Env, dependencies: Auth_Dependencies = {}): Promise<Response> {
    const url = new URL(request.url)
    if (!env.DB) return api_error("auth_unconfigured", "Sign-in is not configured", 503)
    if (url.pathname === "/api/_/auth/passkeys" || url.pathname.startsWith("/api/_/auth/passkeys/")) return passkey_route(request, env)
    if (url.pathname === "/api/_/session") return session_route(request, env)
    if (url.pathname === "/api/_/auth/logout" && request.method === "POST") {
        const session = await read_session(request, env)
        if (!session || !valid_csrf(request, session)) return api_error("forbidden", "Invalid sign-out request", 403)
        await env.DB.prepare("DELETE FROM push_receipts WHERE subscription_id IN (SELECT id FROM push_subscriptions WHERE session_hash = ?)").bind(await auth_hash(session_token(request))).run()
        await env.DB.prepare("DELETE FROM push_subscriptions WHERE session_hash = ?").bind(await auth_hash(session_token(request))).run()
        await env.DB.prepare("DELETE FROM auth_google_grants WHERE session_hash = ?").bind(await auth_hash(read_cookie(request, session_cookie))).run()
        await env.DB.prepare("DELETE FROM auth_sessions WHERE token_hash = ?").bind(await auth_hash(read_cookie(request, session_cookie))).run()
        await realtime_revoke(env, session.subject, await auth_hash(session_token(request)))
        const response = reply({ signed_out: true })
        response.headers.set("set-cookie", cookie(session_cookie, "", 0))
        response.headers.append("set-cookie", cookie(access_cookie, "", 0))
        return response
    }
    if (url.pathname === "/api/_/auth/account/delete" && request.method === "POST") {
        const session = await read_session(request, env)
        if (!session || !valid_csrf(request, session) || request.headers.get("x-jazu-confirm-delete") !== "account") return api_error("forbidden", "Confirm account deletion from the signed-in account menu", 403)
        if (!await recent_auth(request, env, session)) return api_error("step_up_required", "Verify your passkey or sign in with Google again before deleting your account", 403)
        if (!env.DB.batch) return api_error("unavailable", "Account deletion is temporarily unavailable", 503)
        const linked_rooms = env.REALTIME ? (await env.DB.prepare("SELECT id FROM work_rooms WHERE google_subject = ? AND owner_wrap IS NOT NULL").bind(session.subject).all<{ id: string }>()).results : []
        // Revoke every device and linked conversation while preserving the other participant's encrypted history.
        await env.DB.batch([
            env.DB.prepare("DELETE FROM auth_passkey_challenges WHERE session_hash IN (SELECT token_hash FROM auth_sessions WHERE subject = ?)").bind(session.subject),
            env.DB.prepare("DELETE FROM auth_stepups WHERE session_hash IN (SELECT token_hash FROM auth_sessions WHERE subject = ?)").bind(session.subject),
            env.DB.prepare("DELETE FROM auth_passkeys WHERE subject = ?").bind(session.subject),
            env.DB.prepare("DELETE FROM push_receipts WHERE subscription_id IN (SELECT id FROM push_subscriptions WHERE subject = ?)").bind(session.subject),
            env.DB.prepare("DELETE FROM push_subscriptions WHERE subject = ?").bind(session.subject),
            env.DB.prepare("UPDATE work_rooms SET revoked = 1, token_hash = 'deleted:' || id, email = 'deleted-' || id || '@deleted.invalid', google_subject = NULL WHERE google_subject = ?").bind(session.subject),
            env.DB.prepare("DELETE FROM auth_google_grants WHERE session_hash IN (SELECT token_hash FROM auth_sessions WHERE subject = ?)").bind(session.subject),
            env.DB.prepare("DELETE FROM work_key_files WHERE subject = ?").bind(session.subject),
            env.DB.prepare("DELETE FROM unstored_keys WHERE subject = ?").bind(session.subject),
            env.DB.prepare("DELETE FROM work_key_promotions WHERE subject = ?").bind(session.subject),
            ...(env.REALTIME ? [
                env.DB.prepare("DELETE FROM realtime_outbox WHERE source = ? OR target = ?").bind(`a:${session.subject}`, `a:${session.subject}`),
                env.DB.prepare("DELETE FROM last_signed_in WHERE principal = ?").bind(`a:${session.subject}`),
            ] : []),
            env.DB.prepare("DELETE FROM auth_profiles WHERE subject = ?").bind(session.subject),
            env.DB.prepare("DELETE FROM auth_sessions WHERE subject = ?").bind(session.subject),
            env.DB.prepare("DELETE FROM auth_owner WHERE subject = ?").bind(session.subject),
            env.DB.prepare("DELETE FROM auth_users WHERE subject = ?").bind(session.subject),
        ])
        await realtime_revoke(env, session.subject)
        for (const room of linked_rooms) try { await work_changed(env, room.id, session.subject) } catch { /* Metadata is also refreshed on reconnect. */ }
        const response = reply({ deleted: true })
        response.headers.set("set-cookie", cookie(session_cookie, "", 0))
        response.headers.append("set-cookie", cookie(access_cookie, "", 0))
        return response
    }
    if (url.pathname === "/api/_/auth/drive" && request.method === "POST") {
        const session = await read_session(request, env)
        if (!session || !valid_csrf(request, session)) return api_error("forbidden", "Sign in before opening your key storage", 403)
        try { return reply({ access_token: await google_access(env, read_cookie(request, session_cookie), dependencies.fetch, url.searchParams.get("filesystem") === "1") }) }
        catch { return api_error("drive_consent_required", "Sign in again and allow private app data storage in Google Drive", 403) }
    }
    if (url.pathname === "/api/_/auth/profile" && request.method === "POST") {
        const session = await read_session(request, env)
        if (!session || !valid_csrf(request, session)) return api_error("forbidden", "Sign in before loading your profile image", 403)
        if (session.picture) return reply({ picture: session.picture })
        try {
            const access = await google_access(env, read_cookie(request, session_cookie), dependencies.fetch)
            const response = await (dependencies.fetch ?? fetch)("https://openidconnect.googleapis.com/v1/userinfo", { redirect: "manual", signal: AbortSignal.timeout(5000), headers: { authorization: `Bearer ${access}` } })
            if (!response.ok) return reply({ picture: "" })
            const profile = await response.json() as { sub?: string, picture?: string }
            const picture = profile.sub === session.subject ? google_picture(profile.picture) : ""
            if (picture) await env.DB.prepare("INSERT OR REPLACE INTO auth_profiles (subject, picture) VALUES (?, ?)").bind(session.subject, picture).run()
            return reply({ picture })
        } catch { return reply({ picture: "" }) }
    }
    if (request.method !== "GET") return api_error("method_not_allowed", "Use GET", 405)
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_ADMIN_EMAIL) return api_error("auth_unconfigured", "Google sign-in is not configured", 503)
    const redirect_uri = `${url.origin}${callback_path}`
    if (url.pathname === "/api/_/auth/google/start") {
        if (request.headers.has("origin") && request.headers.get("origin") !== url.origin) return api_error("forbidden", "Use this site's sign-in button", 403)
        const state = random(), browser = random(), nonce = random(), verifier = random()
        await env.DB.prepare("DELETE FROM auth_flows WHERE expires_at < ?").bind(Date.now()).run()
        await env.DB.prepare("DELETE FROM auth_sessions WHERE last_seen < ?").bind(Date.now() - month).run()
        await env.DB.prepare("INSERT INTO auth_flows (state_hash, browser_hash, nonce, verifier, expires_at) VALUES (?, ?, ?, ?, ?)").bind(await auth_hash(state), await auth_hash(browser), nonce, verifier, Date.now() + 600000).run()
        const challenge = encode_key(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))))
        const query = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri, response_type: "code", scope: "openid email profile https://www.googleapis.com/auth/drive.appdata", state, nonce, code_challenge: challenge, code_challenge_method: "S256", prompt: "select_account", access_type: "offline" })
        if (url.searchParams.get("filesystem") === "1") {
            query.set("scope", query.get("scope") + " https://www.googleapis.com/auth/drive")
            query.set("prompt", "consent select_account"); query.set("include_granted_scopes", "true")
        }
        if (url.searchParams.get("drive") === "1") query.set("prompt", "consent select_account")
        return new Response(null, { status: 302, headers: { location: `https://accounts.google.com/o/oauth2/v2/auth?${query}`, "set-cookie": cookie(flow_cookie, browser, 600), "cache-control": "no-store", "referrer-policy": "no-referrer" } })
    }
    if (url.pathname !== callback_path) return api_error("not_found", "Unknown authentication route", 404)
    const state = url.searchParams.get("state") ?? "", browser = read_cookie(request, flow_cookie)
    if (!/^[A-Za-z0-9_-]{43}$/.test(state) || !browser) return finish_sign_in("invalid_state")
    const flow = await env.DB.prepare("DELETE FROM auth_flows WHERE state_hash = ? AND browser_hash = ? AND expires_at > ? RETURNING nonce, verifier").bind(await auth_hash(state), await auth_hash(browser), Date.now()).first<{ nonce: string, verifier: string }>()
    if (!flow) return finish_sign_in("invalid_state")
    if (url.searchParams.has("error")) return finish_sign_in(url.searchParams.get("error") === "access_denied" ? "cancelled" : "provider_error")
    const code = url.searchParams.get("code") ?? ""
    if (!code || code.length > 4096) return finish_sign_in("invalid_response")
    let identity: Identity
    let id_token: string
    let token_result: Record<string, unknown>
    try {
        // Workers only supports manual/follow. Never forward the code or secret to a redirect target.
        const response = await (dependencies.fetch ?? fetch)("https://oauth2.googleapis.com/token", { method: "POST", redirect: "manual", signal: AbortSignal.timeout(10000), headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri, grant_type: "authorization_code", code_verifier: flow.verifier }) })
        if (response.status >= 300 && response.status < 400) return finish_sign_in("token_exchange")
        const result = await response.json() as { id_token?: string, error?: string }
        if (!response.ok || !result.id_token) return finish_sign_in(result.error === "invalid_client" ? "client_configuration" : "token_exchange")
        id_token = result.id_token
        token_result = result
    } catch { return finish_sign_in("token_exchange_network") }
    try {
        identity = await verify_google_token(id_token, env.GOOGLE_CLIENT_ID, flow.nonce, dependencies.keys)
    } catch { return finish_sign_in("identity_verification") }
    const now = Date.now()
    await env.DB.prepare("INSERT INTO auth_users (subject, email, name, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(subject) DO UPDATE SET email = excluded.email, name = excluded.name").bind(identity.subject, identity.email, identity.name, now).run()
    if (identity.picture) await env.DB.prepare("INSERT OR REPLACE INTO auth_profiles (subject, picture) VALUES (?, ?)").bind(identity.subject, identity.picture).run()
    if (identity.email === env.GOOGLE_ADMIN_EMAIL.toLowerCase()) await env.DB.prepare("INSERT OR IGNORE INTO auth_owner (id, subject) VALUES (1, ?)").bind(identity.subject).run()
    const token = random()
    await env.DB.prepare("INSERT INTO auth_sessions (token_hash, subject, created_at, last_seen) VALUES (?, ?, ?, ?)").bind(await auth_hash(token), identity.subject, now, now).run()
    await save_google_grant(env, token, token_result)
    const previous = read_cookie(request, session_cookie)
    if (previous) {
        await env.DB.prepare("DELETE FROM auth_google_grants WHERE session_hash = ?").bind(await auth_hash(previous)).run()
        await env.DB.prepare("DELETE FROM auth_sessions WHERE token_hash = ?").bind(await auth_hash(previous)).run()
    }
    const response = finish_sign_in()
    response.headers.append("set-cookie", cookie(session_cookie, token, month / 1000))
    if (env.AUTH_JWT_SECRET) {
        const session = await read_session(new Request(request.url, { headers: { cookie: `${session_cookie}=${token}` } }), env)
        if (session) {
            const access = await issue_access(request, env, session, token)
            if (access) response.headers.append("set-cookie", access)
        }
    }
    return response
}
