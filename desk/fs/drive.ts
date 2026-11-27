/** Google Drive folder as filesystem handles. Tokens live in memory and writes use Drive v3. */
import { get_auth } from "../work/sign.ts"
import type { dir_handle, file_handle } from "./opfs.ts"
const folder_mime = "application/vnd.google-apps.folder"
type Entry = { id: string, name: string, mimeType: string, modifiedTime?: string, capabilities?: { canEdit?: boolean } }
export async function drive_directory(folder_id: string): Promise<dir_handle> {
    if (!/^[a-zA-Z0-9_-]+$/.test(folder_id)) throw new Error("Enter a Google Drive folder ID or folder URL")
    let access = "", email = ""
    const authorize = async () => {
        const auth = await get_auth()
        if (!auth.user) throw new Error("Sign in with Google to connect Drive")
        if (email && auth.user.email !== email) throw new Error("Sign in with Google to reconnect Drive")
        email = auth.user.email
        const response = await fetch("/api/_/auth/drive?filesystem=1", { method: "POST", credentials: "same-origin", headers: { "x-jazu-work": "1", "x-jazu-csrf": auth.csrf } })
        if (!response.ok) throw new Error("drive_consent_required")
        const token = (await response.json()).access_token
        if ((await get_auth()).user?.email !== email) throw new Error("The signed-in account changed")
        access = token
    }
    const request = async (path: string, init: RequestInit = {}): Promise<Response> => {
        if ((await get_auth()).user?.email !== email) throw new Error("Sign in with Google to reconnect Drive")
        const send = () => fetch("https://www.googleapis.com/" + path, { ...init, credentials: "omit", redirect: "error", signal: AbortSignal.timeout(30000), headers: { ...init.headers, authorization: `Bearer ${access}` } })
        let response = await send()
        if (response.status === 401) { await authorize(); response = await send() }
        if (!response.ok) throw new Error(`Google Drive request failed (${response.status})`)
        return response
    }
    const metadata = async (id: string): Promise<Entry> => (await request(`drive/v3/files/${encodeURIComponent(id)}?fields=id,name,mimeType,modifiedTime,capabilities&supportsAllDrives=true`)).json()
    const children = async (id: string): Promise<Entry[]> => {
        const entries: Entry[] = []; let pageToken = ""
        do {
            const query = new URLSearchParams({ q: `'${id}' in parents and trashed = false`, fields: "files(id,name,mimeType,modifiedTime,capabilities),nextPageToken", pageSize: "1000", supportsAllDrives: "true", includeItemsFromAllDrives: "true", ...(pageToken ? { pageToken } : {}) })
            const page = await (await request(`drive/v3/files?${query}`)).json()
            entries.push(...page.files); pageToken = page.nextPageToken || ""
        } while (pageToken)
        return entries
    }
    const file = (entry: Entry): file_handle => {
        const native = entry.mimeType.startsWith("application/vnd.google-apps.")
        return { kind: "file", name: entry.name,
            async move(name: string) {
                if (typeof name !== "string" || !name || /[/\\\0]/.test(name)) throw new DOMException("Invalid name", "TypeError")
                await request(`drive/v3/files/${entry.id}?supportsAllDrives=true`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) })
                entry.name = name
            },
            async getFile() {
                const path = native ? `drive/v3/files/${entry.id}/export?mimeType=application%2Fpdf` : `drive/v3/files/${entry.id}?alt=media&supportsAllDrives=true`
                return new File([await (await request(path)).blob()], entry.name, { type: native ? "application/pdf" : entry.mimeType, lastModified: Date.parse(entry.modifiedTime || "") || 0 })
            },
            ...(!native && entry.capabilities?.canEdit !== false ? { async createWritable() {
                let data: Blob | string = new Blob()
                return { async write(value: Blob | string) { data = value }, async close() {
                    await request(`upload/drive/v3/files/${entry.id}?uploadType=media&supportsAllDrives=true`, { method: "PATCH", body: data })
                } }
            } } : {}),
        }
    }
    const directory = (entry: Entry): dir_handle => {
        const lookup = async (name: string, kind: "file" | "directory", create = false): Promise<Entry> => {
            if (!name || /[/\\\0]/.test(name) || name === "." || name === "..") throw new DOMException("Invalid name", "TypeError")
            const found = (await children(entry.id)).filter(item => item.name === name)
            if (found.length > 1) throw new Error(`Google Drive has multiple entries named ${name}; rename them in Drive first`)
            if (found[0]) {
                if ((found[0].mimeType === folder_mime) !== (kind === "directory")) throw new DOMException("Entry type differs", "TypeMismatchError")
                return found[0]
            }
            if (!create) throw new DOMException("Not found", "NotFoundError")
            return (await request("drive/v3/files?fields=id,name,mimeType,capabilities&supportsAllDrives=true", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, parents: [entry.id], mimeType: kind === "directory" ? folder_mime : "application/octet-stream" }) })).json()
        }
        return { kind: "directory", name: entry.name,
            async *values() { for (const child of await children(entry.id)) yield child.mimeType === folder_mime ? directory(child) : file(child) },
            async getFileHandle(name, options) { return file(await lookup(name, "file", options?.create)) },
            async getDirectoryHandle(name, options) { return directory(await lookup(name, "directory", options?.create)) },
            async removeEntry(name, options) {
                const matches = (await children(entry.id)).filter(item => item.name === name)
                if (matches.length !== 1) throw new Error("Entry is missing or its name is ambiguous")
                const item = matches[0]
                if (item.mimeType === folder_mime && !options?.recursive && (await children(item.id)).length) throw new DOMException("Directory is not empty", "InvalidModificationError")
                await request(`drive/v3/files/${item.id}?supportsAllDrives=true`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ trashed: true }) })
            },
        }
    }
    await authorize()
    const entry = await metadata(folder_id)
    if (entry.mimeType !== folder_mime) throw new Error("Choose a Google Drive folder")
    return directory(entry)
}
