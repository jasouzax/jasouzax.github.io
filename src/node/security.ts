export function api_error(code: string, message: string, status: number): Response {
    return Response.json({ error: { code, message } }, { status, headers: { "cache-control": "no-store" } })
}

// Pages canonicalizes /work to /work/; both the document and SPA payloads are private shells.
export function is_work_path(path: string): boolean {
    return path === "/work" || path.startsWith("/work/")
}

export function secure_response(response: Response, work = false): Response {
    const headers = new Headers(response.headers)
    headers.set("x-content-type-options", "nosniff")
    headers.set("strict-transport-security", "max-age=31536000; includeSubDomains")
    headers.set("referrer-policy", work ? "no-referrer" : "strict-origin-when-cross-origin")
    headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()")
    headers.set("x-frame-options", "DENY")
    if (work) { headers.set("x-robots-tag", "noindex, nofollow"); headers.set("cache-control", "no-store") }
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

const encoder = new TextEncoder()
async function digest(body: string): Promise<string> {
    return hex(await crypto.subtle.digest("SHA-256", encoder.encode(body)))
}
function hex(buffer: ArrayBuffer): string { return [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, "0")).join("") }
async function key(secret: string) {
    return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"])
}
function payload(request: Request, timestamp: string, nonce: string, client: string, body_hash: string): string {
    const url = new URL(request.url)
    return [request.method, url.pathname + url.search, timestamp, nonce, client, body_hash].join("\n")
}

// "stream" leaves the body out of the signature: git push bodies are large binary streams that must not be buffered.
// The mode itself is signed (it replaces the body hash), so a signed "hash" request cannot be downgraded to "stream".
export type body_mode = "hash" | "stream"
const stream_marker = "stream"

export async function sign_origin(request: Request, secret: string, client: string, now = Date.now(), mode: body_mode = "hash"): Promise<Headers> {
    const timestamp = String(Math.floor(now / 1000))
    const nonce = crypto.randomUUID()
    const body_hash = mode === "stream" ? stream_marker : await digest(await request.clone().text())
    const signature = hex(await crypto.subtle.sign("HMAC", await key(secret), encoder.encode(payload(request, timestamp, nonce, client, body_hash))))
    const headers = new Headers({ "x-jazu-time": timestamp, "x-jazu-nonce": nonce, "x-jazu-client": client, "x-jazu-signature": signature })
    if (mode === "stream") headers.set("x-jazu-body", stream_marker)
    return headers
}

// `allow_stream` is true only for routes that accept unsigned bodies (git smart HTTP); every other route keeps the body bound.
export async function verify_origin(request: Request, secret: string, seen: Map<string, number>, now = Date.now(), allow_stream = false): Promise<boolean> {
    const timestamp = request.headers.get("x-jazu-time") ?? ""
    const nonce = request.headers.get("x-jazu-nonce") ?? ""
    const client = request.headers.get("x-jazu-client") ?? ""
    const signature = request.headers.get("x-jazu-signature") ?? ""
    const streamed = request.headers.get("x-jazu-body") === stream_marker
    if (streamed && !allow_stream) return false
    if (!/^\d+$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 60 || !/^[\da-f-]{36}$/i.test(nonce) || !/^[\da-f]{64}$/i.test(signature) || !client || seen.has(nonce)) return false
    const body_hash = streamed ? stream_marker : await digest(await request.clone().text())
    const bytes = new Uint8Array(signature.match(/../g)!.map(pair => parseInt(pair, 16)))
    const valid = await crypto.subtle.verify("HMAC", await key(secret), bytes, encoder.encode(payload(request, timestamp, nonce, client, body_hash)))
    if (!valid) return false
    for (const [id, expires] of seen) if (expires < now) seen.delete(id)
    seen.set(nonce, now + 120_000)
    return true
}
