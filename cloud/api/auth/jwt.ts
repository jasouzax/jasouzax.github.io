/* Five-minute, origin- and refresh-bound access JWTs. D1 remains authoritative for privileged actions. */
import { SignJWT, jwtVerify } from "jose"
import type { Auth_Session } from "../auth.ts"
import { auth_hash } from "../auth.ts"
import { read_cookie, session_cookie, cookie } from "./cookies.ts"
import type { Work_Env } from "../work.ts"
import { google_picture } from "../../../shared/work/profile.ts"

export const access_cookie = "__Host-jazu_access"
export const access_lifetime = 300
const key = (env: Work_Env) => env.AUTH_JWT_SECRET && env.AUTH_JWT_SECRET.length >= 32 ? new TextEncoder().encode(env.AUTH_JWT_SECRET) : null

export async function issue_access(request: Request, env: Work_Env, session: Auth_Session, refresh: string): Promise<string | null> {
    const secret = key(env)
    if (!secret) return null
    const origin = new URL(request.url).origin
    const token = await new SignJWT({ email: session.email, name: session.name, picture: session.picture, role: session.role, sid: await auth_hash(refresh) }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setSubject(session.subject).setIssuer(origin).setAudience("jazu-session").setIssuedAt().setExpirationTime(`${access_lifetime}s`).sign(secret)
    return cookie(access_cookie, token, access_lifetime)
}

export async function read_access(request: Request, env: Work_Env): Promise<Auth_Session | null> {
    const secret = key(env), refresh = read_cookie(request, session_cookie)
    if (!secret || !refresh) return null
    const values = (request.headers.get("cookie") ?? "").split(";").map(value => value.trim()).filter(value => value.startsWith(`${access_cookie}=`))
    if (values.length !== 1) return null
    const token = values[0].slice(access_cookie.length + 1)
    if (token.length > 8192) return null
    try {
        const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"], typ: "JWT", issuer: new URL(request.url).origin, audience: "jazu-session", maxTokenAge: access_lifetime, requiredClaims: ["exp", "iat", "sub", "sid", "email", "name", "role"] })
        if (payload.sid !== await auth_hash(refresh) || typeof payload.sub !== "string" || !payload.sub || typeof payload.email !== "string" || typeof payload.name !== "string" || !["owner", "client"].includes(String(payload.role))) return null
        return { subject: payload.sub, email: payload.email, name: payload.name, picture: google_picture(payload.picture), role: payload.role as "owner" | "client", csrf: await auth_hash(`csrf\n${refresh}`) }
    } catch { return null }
}
