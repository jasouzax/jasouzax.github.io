/* Dispatch fixed system APIs and the isolated custom API prototype. */
import { api_error } from "../security/headers.ts"
import { work_route } from "../api/work.ts"
import { session_route } from "../api/session.ts"
import { health_route } from "../api/health.ts"
import { auth_route } from "../api/auth.ts"
import { realtime_route } from "../room/room.ts"
import { push_route } from "../api/push.ts"
import { projects_route } from "../api/projects.ts"
import { gateway_route, gateway_target, server_route } from "../api/server.ts"
import type { worker_env } from "./index.ts"
export async function api_route(request: Request, env: worker_env): Promise<Response> {
    const url = new URL(request.url), path = url.pathname
    if (path.startsWith("/api/_/projects/")) return projects_route(request, env)
    if (path === "/api/_/realtime") return realtime_route(request, env)
    if (path === "/api/_/server" || path.startsWith("/api/_/server/")) return server_route(request, env)
    if (path.startsWith("/api/_/push/")) return push_route(request, env)
    if (path === "/api/_/session") return session_route(request, env)
    if (path.startsWith("/api/_/auth/")) return auth_route(request, env)
    if (path === "/api" && ["GET", "HEAD"].includes(request.method)) return Response.json({ name: "jazu", version: "v1", health: "/api/_/health", git: `https://repo.${env.DOMAIN}/jazu/_/refs`, runs: `https://repo.${env.DOMAIN}/jazu/_/runs` }, { headers: { "cache-control": "no-store" } })
    if (path === "/api/_/health") return health_route(request, env)
    if (path === "/api/_/work" || path.startsWith("/api/_/work/")) return work_route(request, env)
    const published = env.SERVER_HUB ? gateway_target(url.pathname) : null
    if (published) return gateway_route(request, env, published.name, published.rest)
    return api_error("not_implemented", "This API is not enabled; no client data is accepted", 501)
}
