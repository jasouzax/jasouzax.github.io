/* Public capability status for the fixed system API namespace. */
import type { Work_Env } from "./work.ts"
import { api_error } from "../security/headers.ts"

export function health_route(request: Request, env: Work_Env): Response {
    if (!["GET", "HEAD"].includes(request.method)) return api_error("method_not_allowed", "Use GET or HEAD", 405)
    const response = Response.json({ status: "ok", generation: 12, services: { work: env.DB && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET ? "encrypted_chat" : "not_configured" } }, { headers: { "cache-control": "no-store" } })
    return request.method === "HEAD" ? new Response(null, { status: response.status, headers: response.headers }) : response
}
