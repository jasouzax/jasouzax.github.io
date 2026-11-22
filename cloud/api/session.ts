/* Current opaque-session response; the planned JWT/refresh hybrid remains separate work. */
import { read_session, session_token } from "./auth.ts"
import { cookie, session_cookie, session_lifetime } from "./auth/cookies.ts"
import type { Work_Env } from "./work.ts"
import { api_error } from "../security/headers.ts"

export async function session_route(request: Request, env: Work_Env): Promise<Response> {
    if (!env.DB) return api_error("auth_unconfigured", "Sign-in is not configured", 503)
    if (request.method !== "GET") return api_error("method_not_allowed", "Use GET", 405)
    const session = await read_session(request, env)
    const response = Response.json({ user: session ? { email: session.email, name: session.name, picture: session.picture, role: session.role } : null, csrf: session?.csrf ?? "", google_enabled: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_ADMIN_EMAIL) }, { headers: { "cache-control": "no-store", "referrer-policy": "no-referrer", vary: "Cookie" } })
    const token = session_token(request)
    if (session && token) response.headers.set("set-cookie", cookie(session_cookie, token, session_lifetime / 1000))
    return response
}
