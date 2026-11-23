/* Explicit handler status and safe application headers, separate from the platform's JSON envelope and security policy. */
export class Api_Output {
    readonly value: unknown
    readonly status: number
    readonly headers: Record<string, string>
    constructor(value: unknown, status = 200, headers: Record<string, string> = {}) {
        this.value = value; this.status = status; this.headers = headers
        if (!Number.isInteger(status) || status < 200 || status > 599) throw new Error("Invalid API reply status")
        for (const [name, value] of Object.entries(headers)) {
            if (!/^(x-[a-z0-9-]+|etag|last-modified|location|retry-after)$/i.test(name) || typeof value !== "string" || /[\r\n\0]/.test(value)) throw new Error("Unsupported API response header")
            if (name.toLowerCase() === "location" && !value.startsWith("/") && !/^https?:\/\//i.test(value)) throw new Error("API redirect requires an HTTP(S) or absolute path destination")
        }
    }
}
export class Api_Error extends Error {
    readonly code: string
    readonly status: number
    constructor(code: string, message: string, status = 400) { super(message); this.code = code; this.status = status }
}
