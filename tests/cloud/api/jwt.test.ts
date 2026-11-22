/* Cryptographic binding and revocation regressions use synthetic refresh records only. */
import { test } from "node:test"
import assert from "node:assert/strict"
import { SignJWT } from "jose"
import { issue_access, read_access, access_cookie } from "../../../cloud/api/auth/jwt.ts"
import { auth_hash, read_session } from "../../../cloud/api/auth.ts"
import { session_route } from "../../../cloud/api/session.ts"
import type { Work_Env } from "../../../cloud/api/work.ts"

test("access JWTs bind issuer, refresh cookie, signature and expiry; sensitive reads still check D1", async () => {
    const refresh = "r".repeat(43), env = { AUTH_JWT_SECRET: "k".repeat(43) } as Work_Env
    const session = { subject: "synthetic", email: "client@example.com", name: "Client", role: "client" as const, csrf: await auth_hash(`csrf\n${refresh}`) }
    const request = (value: string, token = refresh, origin = "https://example.com") => new Request(`${origin}/api/_/session`, { headers: { cookie: `__Host-jazu_session=${token}; ${access_cookie}=${value}` } })
    const encoded = (await issue_access(request(""), env, session, refresh))!.split(";")[0].slice(access_cookie.length + 1)
    assert.deepEqual(await read_access(request(encoded), env), { ...session, picture: "" })
    assert.equal(await read_access(request(encoded, "s".repeat(43)), env), null)
    assert.equal(await read_access(request(encoded, refresh, "https://other.example"), env), null)
    assert.equal(await read_access(request(encoded), { AUTH_JWT_SECRET: "x".repeat(43) }), null)
    const expired = await new SignJWT({ email: session.email, name: session.name, role: session.role, sid: await auth_hash(refresh) }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setSubject(session.subject).setIssuer("https://example.com").setAudience("jazu-session").setIssuedAt(1).setExpirationTime(2).sign(new TextEncoder().encode(env.AUTH_JWT_SECRET))
    assert.equal(await read_access(request(expired), env), null)
    let reads = 0
    env.DB = { prepare: () => ({ bind() { return this }, async first() { reads++; return null }, async all() { return { results: [] } }, async run() {} }) }
    assert.equal(await read_session(request(encoded), env), null)
    assert.equal(reads, 1)
    const response = await session_route(request(encoded), env)
    assert.equal((await response.json() as any).user.email, session.email)
    assert.equal(reads, 1)
    const duplicate = request(encoded)
    duplicate.headers.append("cookie", `; ${access_cookie}=${encoded}`)
    assert.equal(await read_access(duplicate, env), null)
})
