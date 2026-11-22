/* Access JWT discovery; refresh and revocation records stay hashed in D1. */
import { read_session, session_token } from "./auth.ts"
import { cookie, session_cookie, session_lifetime } from "./auth/cookies.ts"
import type { Work_Env } from "./work.ts"
import { api_error } from "../security/headers.ts"
import { read_access, issue_access } from "./auth/jwt.ts"

export async function session_route(request: Request, env: Work_Env): Promise<Response> {
    if (!env.DB) return api_error("auth_unconfigured", "Sign-in is not configured", 503)
    if (request.method !== "GET") return api_error("method_not_allowed", "Use GET", 405)
    const access = await read_access(request, env)
    const session = access ?? await read_session(request, env)
    const response = Response.json({ user: session ? { email: session.email, name: session.name, picture: session.picture, role: session.role } : null, csrf: session?.csrf ?? "", google_enabled: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_ADMIN_EMAIL) }, { headers: { "cache-control": "no-store", "referrer-policy": "no-referrer", vary: "Cookie" } })
    const token = session_token(request)
    if (session && token) response.headers.set("set-cookie", cookie(session_cookie, token, session_lifetime / 1000))
    if (session && !access) {
        const value = await issue_access(request, env, session, session_token(request))
        if (value) response.headers.append("set-cookie", value)
    }
    return response
}
