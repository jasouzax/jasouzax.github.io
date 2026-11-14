/* Normal Drive keys travel directly to Google; client fallback recovery uses the Worker. */
import { decode_key, type Owner_Wrap } from "../../work_crypto.ts"
export type Client_Key = { room: string, key: string, owner_wrap: Owner_Wrap, key_id: string }
export type Key_Vault = { v: 2, owner?: { private_jwk: JsonWebKey, public_jwk: JsonWebKey }, client?: Client_Key }
type Api = (path: string, body?: unknown) => Promise<any>
// Staging and production can share an OAuth client without sharing conversation identities.
const filename = `jazu-work-keys-v2-${globalThis.location?.host ?? "localhost"}.json`
let cached: { email: string, pending: Promise<Drive_Vault> } | null = null

export function clear_drive(): void { cached = null }

function validate(value: Key_Vault): Key_Vault {
    if (!value || value.v !== 2 || Boolean(value.owner) === Boolean(value.client)) throw new Error("The private key file in Google Drive is invalid")
    if (value.client && (!/^[a-f0-9-]{36}$/i.test(value.client.room) || decode_key(value.client.key).length !== 32 || !value.client.owner_wrap || typeof value.client.key_id !== "string")) throw new Error("The private conversation key is invalid")
    if (value.owner && (value.owner.private_jwk?.kty !== "EC" || !value.owner.private_jwk.d || value.owner.public_jwk?.kty !== "EC")) throw new Error("The private owner key is invalid")
    return value
}

export function open_drive(email: string, api: Api): Promise<Drive_Vault> {
    if (cached?.email !== email) cached = { email, pending: Drive_Vault.open(api) }
    return cached.pending.catch(error => { cached = null; throw error })
}

export class Drive_Vault {
    private access = ""
    private file_id = ""
    value: Key_Vault | null = null
    private constructor(private api: Api) {}
    private async request(path: string, init: RequestInit = {}): Promise<Response> {
        const send = () => fetch(`https://www.googleapis.com/${path}`, { ...init, credentials: "omit", redirect: "error", signal: AbortSignal.timeout(15000), headers: { ...init.headers, authorization: `Bearer ${this.access}` } })
        let response = await send()
        if (response.status === 401) { this.access = (await this.api("/api/v1/auth/drive", {})).access_token; response = await send() }
        if (!response.ok && response.status !== 404 && response.status !== 409) throw new Error(response.status === 401 ? "Sign in again to reconnect Google Drive" : "Google Drive is unavailable. Check that Drive API is enabled and private app data access is allowed.")
        return response
    }
    static async open(api: Api): Promise<Drive_Vault> {
        const vault = new Drive_Vault(api)
        vault.access = (await api("/api/v1/auth/drive", {})).access_token
        let file_id = (await api("/api/v1/work/key-file")).file_id
        if (!file_id) {
            const query = new URLSearchParams({ spaces: "appDataFolder", q: `name = '${filename}' and trashed = false`, fields: "files(id),nextPageToken", pageSize: "100" })
            const files = await (await vault.request(`drive/v3/files?${query}`)).json()
            if (files.nextPageToken || files.files?.length > 1) throw new Error("Multiple private key files exist. They have been preserved; no keys were overwritten.")
            const generated = files.files?.[0]?.id ?? (await (await vault.request("drive/v3/files/generateIds?count=1&space=appDataFolder&type=files")).json()).ids?.[0]
            file_id = (await api("/api/v1/work/key-file", { file_id: generated })).file_id
        }
        vault.file_id = file_id
        await vault.read()
        return vault
    }
    private async read(): Promise<void> {
        const response = await this.request(`drive/v3/files/${encodeURIComponent(this.file_id)}?alt=media`)
        this.value = response.status === 404 ? null : validate(await response.json())
    }
    async create(value: Key_Vault): Promise<Key_Vault> {
        if (this.value) return this.value
        validate(value)
        // A reserved Google file ID and immutable create prevent two devices from overwriting keys.
        const boundary = "jazu_" + crypto.randomUUID().replace(/-/g, "")
        const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ id: this.file_id, name: filename, parents: ["appDataFolder"] })}\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(value)}\r\n--${boundary}--\r\n`
        const response = await this.request("upload/drive/v3/files?uploadType=multipart&fields=id", { method: "POST", headers: { "content-type": `multipart/related; boundary=${boundary}` }, body })
        if (response.status === 404) throw new Error("Google Drive could not create the private key file")
        if (response.status === 409) await this.read()
        else await this.read()
        if (!this.value) throw new Error("The private key file is not available yet; retry shortly")
        return this.value
    }
}
