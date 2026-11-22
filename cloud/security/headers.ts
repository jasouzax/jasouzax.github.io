export { sign_origin, verify_origin, type body_mode } from "../../shared/sign.ts"

export { api_error, is_work_path } from "../../shared/http.ts"

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
