/*
 * Public pull-only OCI/Docker registry. Immutable blobs and repository indexes live in a dedicated R2 bucket.
 * Images are published by the authenticated operator tool, not anonymous HTTP writes. No Pi dependency is
 * needed for pulling an image after an SD-card failure. Digest URLs can be cached at the Cloudflare edge.
 */
type Object_Meta = { size: number, httpEtag: string, range?: { offset: number, length: number } }
type Object_Body = Object_Meta & { body: ReadableStream<Uint8Array>, text(): Promise<string> }
export type Registry_Env = { DOMAIN: string, BLOBS: { get(key: string, options?: { range?: Headers }): Promise<Object_Body | null>, head(key: string): Promise<Object_Meta | null> } }
type Repository_Index = { schema: number, tags: Record<string, string>, manifests: Record<string, string>, blobs: string[] }
const digest_pattern = /^sha256:[a-f0-9]{64}$/
const repository_pattern = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/
const api_headers = { "docker-distribution-api-version": "registry/2.0", "x-content-type-options": "nosniff" }

function failure(code: string, message: string, status = 404): Response {
    return Response.json({ errors: [{ code, message }] }, { status, headers: { ...api_headers, "cache-control": "no-store" } })
}

export async function registry_route(request: Request, env: Registry_Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.hostname !== env.DOMAIN && !["localhost", "127.0.0.1"].includes(url.hostname)) return failure("NAME_UNKNOWN", "Unknown registry host")
    if (!["GET", "HEAD"].includes(request.method)) return failure("UNSUPPORTED", "This registry is pull-only; use the authenticated release publisher", 405)
    const head = request.method === "HEAD"
    if (["/v2", "/v2/"].includes(url.pathname)) return new Response(head ? null : "{}", { headers: { ...api_headers, "content-type": "application/json", "cache-control": "no-store" } })
    if (url.pathname === "/v2/_catalog") {
        const object = await env.BLOBS.get("catalog.json")
        return new Response(head ? null : object?.body ?? '{"repositories":[]}', { headers: { ...api_headers, "content-type": "application/json", "cache-control": "no-store" } })
    }
    const match = /^\/v2\/(.+)\/(manifests|blobs|tags)\/([^/]+)$/.exec(url.pathname)
    if (!match || !repository_pattern.test(match[1])) return failure("NAME_UNKNOWN", "Unknown repository")
    const [, repository, kind, reference] = match
    const object = await env.BLOBS.get(`repos/${repository}/index.json`)
    if (!object || object.size > 4 * 1024 * 1024) return failure("NAME_UNKNOWN", "Unknown repository")
    const index = JSON.parse(await object.text()) as Repository_Index
    if (index.schema !== 1) return failure("UNKNOWN", "Invalid registry index", 503)
    if (kind === "tags") {
        if (reference !== "list") return failure("NAME_UNKNOWN", "Unknown tag operation")
        return new Response(head ? null : JSON.stringify({ name: repository, tags: Object.keys(index.tags).sort() }), { headers: { ...api_headers, "content-type": "application/json", "cache-control": "no-store" } })
    }
    const digest = kind === "manifests" && Object.hasOwn(index.tags, reference) ? index.tags[reference] : reference
    if (!digest_pattern.test(digest)) return failure(kind === "blobs" ? "BLOB_UNKNOWN" : "MANIFEST_UNKNOWN", "Unknown digest or tag")
    if (kind === "manifests" ? !Object.hasOwn(index.manifests, digest) : !index.blobs.includes(digest)) return failure(kind === "blobs" ? "BLOB_UNKNOWN" : "MANIFEST_UNKNOWN", "Object does not belong to this repository")
    const key = `blobs/sha256/${digest.slice(7)}`
    const value = head ? await env.BLOBS.head(key) : await env.BLOBS.get(key, request.headers.has("range") ? { range: request.headers } : undefined)
    if (!value) return failure(kind === "blobs" ? "BLOB_UNKNOWN" : "MANIFEST_UNKNOWN", "Registry object is unavailable")
    const partial = !head && request.headers.has("range") ? value.range : undefined
    const headers = new Headers({ ...api_headers, "content-type": kind === "manifests" ? index.manifests[digest] : "application/octet-stream", "docker-content-digest": digest, etag: `"${digest}"`, "accept-ranges": "bytes", "content-length": String(partial?.length ?? value.size), "cache-control": kind === "blobs" || digest_pattern.test(reference) ? "public, max-age=31536000, immutable" : "no-store" })
    if (request.headers.get("if-none-match") === headers.get("etag")) return new Response(null, { status: 304, headers })
    if (partial) headers.set("content-range", `bytes ${partial.offset}-${partial.offset + partial.length - 1}/${value.size}`)
    return new Response(head ? null : (value as Object_Body).body, { status: partial ? 206 : 200, headers })
}

export default {
    async fetch(request: Request, env: Registry_Env, context: { waitUntil(promise: Promise<unknown>): void }): Promise<Response> {
        try {
            const immutable = /\/(?:blobs|manifests)\/sha256:[a-f0-9]{64}$/.test(new URL(request.url).pathname)
            const cache = typeof caches === "undefined" ? undefined : (caches as CacheStorage & { default: Cache }).default
            if (immutable && request.method === "GET" && cache) {
                const cached = await cache.match(request)
                if (cached) return cached
            }
            const response = await registry_route(request, env)
            if (immutable && request.method === "GET" && response.status === 200 && !request.headers.has("range") && cache) context.waitUntil(cache.put(request, response.clone()).catch(() => {}))
            return response
        } catch { return failure("UNKNOWN", "Registry temporarily unavailable", 503) }
    },
}
