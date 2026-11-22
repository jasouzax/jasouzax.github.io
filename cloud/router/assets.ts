/* Serve hashed object storage with ranges and conditional requests. */
import type { worker_env } from "./index.ts"
export async function static_object(request: Request, env: worker_env, key: string): Promise<Response | null> {
    const path = `/${key}`
    const object = await env.ASSETS?.get(key, { range: request.headers, onlyIf: request.headers })
    if (object) {
        const headers = new Headers({ etag: object.httpEtag, "accept-ranges": "bytes", "cache-control": "public, max-age=31536000, immutable", "access-control-allow-origin": `https://${env.DOMAIN}` })
        object.writeHttpMetadata(headers)
        if (path === "/assets/wasm/manifest.json") headers.set("cache-control", "no-cache")
        if (path.endsWith(".wasm")) headers.set("content-type", "application/wasm")
        if ((path.endsWith(".js") || path.endsWith(".mjs"))) headers.set("content-type", "text/javascript")
        if (path.endsWith(".json")) headers.set("content-type", "application/json")
        if (path.endsWith(".zip")) headers.set("content-type", "application/zip")
        if (/\.(whl|pack|idx)$/.test(path)) headers.set("content-type", "application/octet-stream")
        if (!object.body) return new Response(null, { status: request.headers.has("if-none-match") ? 304 : 412, headers })
        if (object.range) headers.set("content-range", `bytes ${object.range.offset}-${object.range.offset + object.range.length - 1}/${object.size}`)
        return new Response(request.method === "HEAD" ? null : object.body, { status: object.range ? 206 : 200, headers })
    }
    return null
}
