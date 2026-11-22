export { sign_origin, verify_origin, type body_mode } from "../../shared/sign.ts"

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
