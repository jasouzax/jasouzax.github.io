/* The signed origin owns public SSR structure; request data never selects commands or snapshot modules. */
import { createHash } from "node:crypto"
import { jsx, to_html } from "../../shared/vnode/vnode.tsx"
import { take_snapshot, public_structure, type Snapshot } from "../terminal/fastfetch.ts"

const html = to_html(jsx("section", { class: "server_public_snapshot", "aria-label": "Public server status" },
    jsx("p", {}, "{{state}}"), jsx("time", { datetime: "{{iso}}" }, "{{iso}}"), jsx("pre", {}, "{{text}}")))
export const status_revision = createHash("sha256").update(html).digest("hex")

export async function public_status_route(request: Request, snapshot: () => Promise<Snapshot> = () => take_snapshot(public_structure)): Promise<Response | null> {
    const path = new URL(request.url).pathname
    if (path !== "/render/server/template" && path !== "/render/server/data") return null
    if (request.method !== "GET") return new Response(null, { status: 405, headers: { allow: "GET" } })
    const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" }
    if (path.endsWith("/template")) return Response.json({ revision: status_revision, html }, { headers })
    const data = await snapshot()
    return Response.json({ revision: status_revision, text: data.text.slice(0, 8192), taken_at: data.taken_at }, { headers })
}
