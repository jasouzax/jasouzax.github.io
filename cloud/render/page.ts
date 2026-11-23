/* Public HTML and SPA payloads receive the same inert status; a failed dynamic service preserves static Pages. */
import type { Rendered_Status } from "../../shared/render/status.ts"
import type { Hub_Namespace } from "../api/server.ts"
import type { serialized_node } from "../../shared/vnode/vnode.tsx"

export const server_page_path = (path: string): boolean => /^(?:\/[a-z]{2}(?:-[a-z]{2})?)?\/server(?:\/index\.(?:html|json))?\/?$/i.test(path)

export async function render_server_page(request: Request, response: Response, hub?: Hub_Namespace): Promise<Response> {
    if (!hub || response.status !== 200 || !["GET", "HEAD"].includes(request.method)) return response
    const type = response.headers.get("content-type") || ""
    if (!type.includes("text/html") && !type.includes("application/json")) return response
    try {
        const dynamic = await hub.get(hub.idFromName("main")).fetch(new Request("https://server.internal/render/server", { headers: { "x-jazu-role": "worker" } }))
        if (!dynamic.ok) return response
        const rendered = await dynamic.json() as Rendered_Status
        if (typeof rendered.html !== "string" || rendered.html.length > 65536 || typeof rendered.text !== "string" || rendered.text.length > 16384 || typeof rendered.stale !== "boolean") return response
        let body: string
        if (type.includes("application/json")) {
            const payload = await response.clone().json() as { main?: serialized_node }
            let changed = false
            const visit = (node: serialized_node): void => {
                if (!Array.isArray(node)) return
                if (node[0] === "div" && Object.hasOwn(node[1], "data-server-render")) {
                    node.splice(2, node.length - 2, ["pre", {}, rendered.text]); changed = true
                } else for (const child of node.slice(2)) visit(child as serialized_node)
            }
            if (payload.main) visit(payload.main)
            if (!changed) return response
            body = JSON.stringify(payload)
        } else {
            const original = await response.clone().text()
            const marker = /(<div class="server_public_render" data-server-render="">)[\s\S]*?(<\/div>)/
            if (!marker.test(original)) return response
            body = original.replace(marker, (_, open, close) => open + rendered.html + close)
        }
        const headers = new Headers(response.headers)
        for (const name of ["content-length", "content-encoding", "etag", "last-modified"]) headers.delete(name)
        headers.set("cache-control", "public, max-age=60")
        headers.set("x-jazu-render", rendered.stale ? "stale" : "fresh")
        return new Response(request.method === "HEAD" ? null : body, { status: response.status, headers })
    } catch { return response }
}
