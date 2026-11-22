/* Profile images come only from Google's verified identity/userinfo responses. */
export function google_picture(value: unknown): string {
    if (typeof value !== "string" || value.length > 2048) return ""
    try {
        const url = new URL(value)
        return url.protocol === "https:" && !url.username && !url.password && !url.port && (url.hostname === "googleusercontent.com" || url.hostname.endsWith(".googleusercontent.com")) ? url.href : ""
    } catch { return "" }
}
