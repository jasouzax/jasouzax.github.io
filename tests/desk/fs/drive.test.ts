import { test } from "node:test"
import assert from "node:assert/strict"
import { drive_directory } from "../../../desk/fs/drive.ts"

test("Drive folders page listings, reject ambiguous names, upload bytes and trash entries", async () => {
    const original = globalThis.fetch
    const rows = [{ id: "hello", name: "hello.txt", mimeType: "text/plain" }]
    let content = "hello", trashed = "", pages = 0
    globalThis.fetch = async (input, init) => {
        const path = String(input)
        if (path.startsWith("/api/_/session")) return Response.json({ user: { email: "drive@example.com", name: "Drive", role: "client" }, csrf: "csrf", google_enabled: true })
        if (path === "/api/_/auth/drive?filesystem=1") { assert.equal((init!.headers as Record<string, string>)["x-jazu-csrf"], "csrf"); return Response.json({ access_token: "memory-only" }) }
        assert.equal((init!.headers as Record<string, string>).authorization, "Bearer memory-only")
        const url = new URL(path)
        if (url.pathname === "/drive/v3/files/folder") return Response.json({ id: "folder", name: "Shared", mimeType: "application/vnd.google-apps.folder" })
        if (url.pathname === "/drive/v3/files" && init?.method === "POST") { const row = { ...JSON.parse(init.body as string), id: "created" }; rows.push(row); return Response.json(row) }
        if (url.pathname === "/drive/v3/files" && url.searchParams.has("q")) {
            pages++
            return Response.json(url.searchParams.get("pageToken") ? { files: rows.slice(1) } : { files: rows.slice(0, 1), nextPageToken: "page2" })
        }
        if (url.pathname.startsWith("/upload/")) { content = init!.body instanceof Blob ? await init!.body.text() : String(init!.body); return Response.json({}) }
        if (init?.method === "PATCH") { trashed = url.pathname.split("/").at(-1)!; assert.equal(JSON.parse(init.body as string).trashed, true); return Response.json({}) }
        if (url.searchParams.get("alt") === "media") return new Response(content)
        throw new Error("Unexpected request " + path)
    }
    try {
        const directory = await drive_directory("folder")
        assert.equal(directory.name, "Shared")
        const file = await directory.getFileHandle("hello.txt")
        assert.equal(await (await file.getFile()).text(), "hello")
        const writer = await file.createWritable!(); await writer.write("changed"); await writer.close()
        assert.equal(await (await file.getFile()).text(), "changed")
        await directory.getFileHandle("created.txt", { create: true })
        assert.ok(rows.some(row => row.name === "created.txt"))
        rows.push({ id: "duplicate", name: "hello.txt", mimeType: "text/plain" })
        await assert.rejects(directory.getFileHandle("hello.txt"), /multiple entries/)
        rows.pop()
        await directory.removeEntry("hello.txt")
        assert.equal(trashed, "hello")
        assert.ok(pages >= 8)
    } finally { globalThis.fetch = original }
})
