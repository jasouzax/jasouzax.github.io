/*
 * Server-backed Google sign-in. The browser stores no ID/access tokens or trusted profile claims.
 * Full-page authorization redirects preserve this tab's local encryption keys and avoid popup isolation conflicts.
 */
export type Auth_State = { user: { email: string, name: string, role: "owner" | "client" } | null, csrf: string, google_enabled: boolean }
let current: Auth_State | null = null
let pending: Promise<Auth_State> | null = null

export function get_auth(): Promise<Auth_State> {
    return pending ??= fetch("/api/v1/auth/session", { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(10000) }).then(async response => {
        if (!response.ok) throw new Error("Sign-in service is unavailable")
        current = await response.json() as Auth_State
        return current
    }).catch(error => { pending = null; throw error })
}

function paint(): void {
    for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-sign="google"]')) {
        const text = button.querySelector<HTMLElement>(".sign_text")
        if (!text) continue
        const idle = button.dataset.idle ?? text.textContent ?? ""
        button.dataset.idle = idle
        button.dataset.signed = current?.user ? "out" : "in"
        text.textContent = current?.user ? `${button.dataset.outText ?? "Sign out"} (${current.user.name})` : idle
        button.title = current?.user?.email ?? ""
    }
}

export async function sign_out(): Promise<void> {
    const auth = await get_auth()
    if (auth.user) {
        const response = await fetch("/api/v1/auth/logout", { method: "POST", credentials: "same-origin", headers: { "x-jazu-work": "1", "x-jazu-csrf": auth.csrf }, signal: AbortSignal.timeout(10000) })
        if (!response.ok) throw new Error("Could not sign out; please try again")
    }
    current = { user: null, csrf: "", google_enabled: auth.google_enabled }
    pending = Promise.resolve(current)
    try { for (const key of Object.keys(sessionStorage)) if (key.startsWith("jazu_work_")) sessionStorage.removeItem(key) } catch {}
    paint()
    document.dispatchEvent(new Event("jazu:auth"))
}

export function init_sign(): void {
    // Retire the former unverified, browser-only profile cache.
    try { localStorage.removeItem("jazu_user"); sessionStorage.removeItem("jazu_nonce") } catch {}
    void get_auth().then(() => { paint(); document.dispatchEvent(new Event("jazu:auth")) }).catch(() => {})
    document.addEventListener("click", event => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-sign="google"]')
        if (!button) return
        event.preventDefault()
        button.disabled = true
        void get_auth().then(async auth => {
            if (auth.user) await sign_out()
            else {
                if (!auth.google_enabled) throw new Error("Google sign-in is not configured on this site")
                location.assign("/api/v1/auth/google/start")
            }
        }).catch(error => {
            const status = document.createElement("p")
            status.setAttribute("role", "alert")
            status.textContent = error instanceof Error ? error.message : "Sign-in is unavailable"
            button.after(status)
        }).finally(() => { button.disabled = false })
    })
    document.addEventListener("jazu:page", paint)
}
