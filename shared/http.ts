/* HTTP shapes and private-shell classification used by cloud and local hosting. */
export function api_error(code: string, message: string, status: number): Response {
    return Response.json({ error: { code, message } }, { status, headers: { "cache-control": "no-store" } })
}

// Pages canonicalizes /work to /work/; both the document and SPA payloads are private shells.
export function is_work_path(path: string): boolean {
    return path === "/work" || path.startsWith("/work/")
}
