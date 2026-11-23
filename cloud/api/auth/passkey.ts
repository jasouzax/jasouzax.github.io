/* Optional, user-verified passkeys. Single-use challenges are bound to the exact refresh session and origin. */
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse, type RegistrationResponseJSON, type AuthenticationResponseJSON, type AuthenticatorTransport } from "@simplewebauthn/server"
import { auth_hash, read_session, session_token, valid_csrf, type Auth_Session } from "../auth.ts"
import type { Work_Env } from "../work.ts"
import { encode_key, decode_key } from "../../../shared/work/crypto.ts"
import { api_error } from "../../security/headers.ts"
import { access_cookie } from "./jwt.ts"
import { cookie } from "./cookies.ts"

type Passkey = { id: string, subject: string, public_key: string, counter: number, transports: string, name: string, created_at: number }
const recent_ms = 5 * 60 * 1000
const reply = (data: unknown) => Response.json(data, { headers: { "cache-control": "no-store", "referrer-policy": "no-referrer", vary: "Cookie" } })
export async function recent_auth(request: Request, env: Work_Env, session: Auth_Session): Promise<boolean> {
    const hash = await auth_hash(session_token(request))
    const row = await env.DB!.prepare("SELECT s.created_at, p.verified_at, (SELECT count(*) FROM auth_passkeys WHERE subject = s.subject) AS keys FROM auth_sessions s LEFT JOIN auth_stepups p ON p.session_hash = s.token_hash WHERE s.token_hash = ? AND s.subject = ?").bind(hash, session.subject).first<{ created_at: number, verified_at: number | null, keys: number }>()
    return !!row && (row.keys ? (row.verified_at ?? 0) : row.created_at) > Date.now() - recent_ms
}

async function body_of(request: Request): Promise<Record<string, any>> {
    if (!request.headers.get("content-type")?.startsWith("application/json")) throw new Error("Expected JSON")
    const reader = request.body?.getReader()
    if (!reader) throw new Error("Missing body")
    const chunks: Uint8Array[] = []; let length = 0
    try {
        while (true) {
            const chunk = await reader.read()
            if (chunk.done) break
            length += chunk.value.length
            if (length > 32768) throw new Error("Passkey response is too large")
            chunks.push(chunk.value)
        }
    } finally { await reader.cancel() }
    const bytes = new Uint8Array(length); let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
    const value = JSON.parse(new TextDecoder().decode(bytes))
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected JSON object")
    return value
}

export async function passkey_route(request: Request, env: Work_Env): Promise<Response> {
    const session = await read_session(request, env)
    if (!session) return api_error("unauthorized", "Sign in before managing passkeys", 401)
    const url = new URL(request.url), path = url.pathname.slice("/api/_/auth/passkeys".length), db = env.DB!
    const hash = await auth_hash(session_token(request)), rpID = url.hostname
    if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(rpID)) return api_error("forbidden", "Passkeys require a secure origin", 403)
    const keys = (await db.prepare("SELECT * FROM auth_passkeys WHERE subject = ? ORDER BY created_at").bind(session.subject).all<Passkey>()).results
    if (request.method === "GET" && path === "") return reply({ keys: keys.map(({ id, name, created_at }) => ({ id, name, created_at })), recent: await recent_auth(request, env, session), owner_locked: session.step_up === true })
    if (request.method !== "POST") return api_error("method_not_allowed", "Use POST", 405)
    if (!valid_csrf(request, session)) return api_error("forbidden", "Invalid passkey request", 403)
    const recent = () => recent_auth(request, env, session)
    if (path === "/register/options" || path === "/remove") {
        if (!await recent()) return api_error("step_up_required", keys.length ? "Verify your passkey first" : "Sign in with Google again before changing account security", 403)
    }
    try {
        if (path === "/register/options") {
            if (keys.length >= 10) return api_error("limit", "At most ten passkeys per account", 409)
            const userID = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${url.origin}\n${session.subject}`)))
            const options = await generateRegistrationOptions({ rpName: "JAZU", rpID, userID, userName: session.email, userDisplayName: session.name, attestationType: "none", supportedAlgorithmIDs: [-7, -257], authenticatorSelection: { residentKey: "preferred", userVerification: "required" }, excludeCredentials: keys.map(key => ({ id: key.id, transports: JSON.parse(key.transports) })) })
            await db.prepare("DELETE FROM auth_passkey_challenges WHERE expires_at < ?").bind(Date.now()).run()
            await db.prepare("INSERT OR REPLACE INTO auth_passkey_challenges (session_hash, purpose, challenge, expires_at) VALUES (?, 'register', ?, ?)").bind(hash, options.challenge, Date.now() + recent_ms).run()
            return reply(options)
        }
        if (path === "/verify/options") {
            if (!keys.length) return api_error("no_passkey", "No passkey is registered; sign in with Google again", 409)
            const options = await generateAuthenticationOptions({ rpID, userVerification: "required", allowCredentials: keys.map(key => ({ id: key.id, transports: JSON.parse(key.transports) })) })
            await db.prepare("DELETE FROM auth_passkey_challenges WHERE expires_at < ?").bind(Date.now()).run()
            await db.prepare("INSERT OR REPLACE INTO auth_passkey_challenges (session_hash, purpose, challenge, expires_at) VALUES (?, 'verify', ?, ?)").bind(hash, options.challenge, Date.now() + recent_ms).run()
            return reply(options)
        }
        if (path === "/register" || path === "/verify") {
            const body = await body_of(request), purpose = path === "/register" ? "register" : "verify"
            // Consume before cryptographic verification: failures cannot be replayed or shared across devices.
            const challenge = await db.prepare("DELETE FROM auth_passkey_challenges WHERE session_hash = ? AND purpose = ? AND expires_at > ? RETURNING challenge").bind(hash, purpose, Date.now()).first<{ challenge: string }>()
            if (!challenge) return api_error("invalid_challenge", "Start passkey verification again", 400)
            if (purpose === "register") {
                if (!await recent() || keys.length >= 10) return api_error("step_up_required", "Verify your account again", 403)
                const result = await verifyRegistrationResponse({ response: body.credential as RegistrationResponseJSON, expectedChallenge: challenge.challenge, expectedOrigin: url.origin, expectedRPID: rpID, requireUserVerification: true })
                if (!result.verified || !result.registrationInfo) throw new Error("Registration did not verify")
                const key = result.registrationInfo.credential
                const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "Passkey"
                if (!db.batch) throw new Error("Atomic passkey storage unavailable")
                await db.batch([
                    db.prepare("INSERT INTO auth_passkeys (id, subject, public_key, counter, transports, name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(key.id, session.subject, encode_key(key.publicKey), key.counter, JSON.stringify(key.transports ?? []), name || "Passkey", Date.now()),
                    db.prepare("INSERT OR REPLACE INTO auth_stepups (session_hash, verified_at) VALUES (?, ?)").bind(hash, Date.now()),
                ])
            } else {
                const credential = body.credential as AuthenticationResponseJSON
                const key = keys.find(key => key.id === credential?.id)
                if (!key) return api_error("invalid_credential", "This passkey does not belong to your account", 403)
                const result = await verifyAuthenticationResponse({ response: credential, expectedChallenge: challenge.challenge, expectedOrigin: url.origin, expectedRPID: rpID, requireUserVerification: true, credential: { id: key.id, publicKey: decode_key(key.public_key), counter: key.counter, transports: JSON.parse(key.transports) as AuthenticatorTransport[] } })
                if (!result.verified || !db.batch) throw new Error("Passkey did not verify")
                // Compare-and-swap the signature counter; a concurrent assertion cannot silently overwrite a newer counter.
                const updated = await db.prepare("UPDATE auth_passkeys SET counter = ? WHERE id = ? AND subject = ? AND counter = ? RETURNING id").bind(result.authenticationInfo.newCounter, key.id, session.subject, key.counter).first<{ id: string }>()
                if (!updated) throw new Error("Passkey changed during verification")
                await db.prepare("INSERT OR REPLACE INTO auth_stepups (session_hash, verified_at) SELECT ?, ? WHERE EXISTS (SELECT 1 FROM auth_passkeys WHERE id = ? AND subject = ?)").bind(hash, Date.now(), key.id, session.subject).run()
            }
            const response = reply({ verified: true })
            response.headers.append("set-cookie", cookie(access_cookie, "", 0))
            return response
        }
        if (path === "/remove") {
            const body = await body_of(request)
            if (typeof body.id !== "string" || !keys.some(key => key.id === body.id)) return api_error("not_found", "Passkey not found", 404)
            await db.prepare("DELETE FROM auth_passkeys WHERE id = ? AND subject = ?").bind(body.id, session.subject).run()
            return reply({ removed: true })
        }
        return api_error("not_found", "Unknown passkey route", 404)
    } catch { return api_error("invalid_passkey", "Passkey verification failed; try again", 400) }
}
