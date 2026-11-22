/* Cookie encoding and parsing shared by authentication and session endpoints. */
export const session_cookie = "__Host-jazu_session"
export const session_lifetime = 30 * 86400000
export const cookie = (name: string, value: string, seconds: number) => `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${seconds}`

export function read_cookie(request: Request, name: string): string {
    const values = (request.headers.get("cookie") ?? "").split(";").map(value => value.trim()).filter(value => value.startsWith(name + "="))
    if (values.length !== 1) return ""
    const value = values[0].slice(name.length + 1)
    return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : ""
}
