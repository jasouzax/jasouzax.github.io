/*
 * Server-backed Google identity. Provider tokens never enter browser persistent storage.
 * Short-lived Drive access lives in memory; guest keys remain local until Google sign-in saves them to Drive or encrypted client recovery storage.
 */
export type Auth_State = { user: { email: string, name: string, picture?: string, role: "owner" | "client" } | null, csrf: string, google_enabled: boolean }
let current: Auth_State | null = null
let pending: Promise<Auth_State> | null = null

export function get_auth(refresh = false): Promise<Auth_State> {
    if (refresh) pending = null
    return pending ??= fetch("/api/v1/auth/session", { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(10000) }).then(async response => {
        if (!response.ok) throw new Error("Sign-in service is unavailable")
        current = await response.json() as Auth_State
        return current
    }).catch(error => { pending = null; throw error })
}

function paint(): void {
    const signed_in = Boolean(current?.user)
    for (const item of document.querySelectorAll<HTMLElement>("[data-auth]")) item.hidden = (item.dataset.auth === "user") !== signed_in
}

function clear_identity(google_enabled: boolean): void {
    current = { user: null, csrf: "", google_enabled }
    pending = Promise.resolve(current)
    try { for (const key of Object.keys(sessionStorage)) if (key.startsWith("jazu_work_")) sessionStorage.removeItem(key) } catch {}
    paint()
    document.dispatchEvent(new Event("jazu:auth"))
}

export async function sign_out(): Promise<void> {
    const auth = await get_auth()
    if (auth.user) {
        const response = await fetch("/api/v1/auth/logout", { method: "POST", credentials: "same-origin", headers: { "x-jazu-work": "1", "x-jazu-csrf": auth.csrf }, signal: AbortSignal.timeout(10000) })
        if (!response.ok) throw new Error("Could not sign out; please try again")
    }
    clear_identity(auth.google_enabled)
}

async function delete_account(): Promise<void> {
    const auth = await get_auth()
    if (!auth.user) throw new Error("Sign in before deleting your account")
    const response = await fetch("/api/v1/auth/account/delete", { method: "POST", credentials: "same-origin", headers: { "x-jazu-work": "1", "x-jazu-csrf": auth.csrf, "x-jazu-confirm-delete": "account" }, signal: AbortSignal.timeout(15000) })
    if (!response.ok) throw new Error("Could not delete the account; please try again")
    clear_identity(auth.google_enabled)
}

export function init_sign(): void {
    // Retire the former unverified, browser-only profile cache.
    try { localStorage.removeItem("jazu_user"); sessionStorage.removeItem("jazu_nonce") } catch {}
    void get_auth().then(auth => {
        paint(); document.dispatchEvent(new Event("jazu:auth"))
        if (auth.user && !auth.user.picture) void fetch("/api/v1/auth/profile", { method: "POST", credentials: "same-origin", headers: { "x-jazu-work": "1", "x-jazu-csrf": auth.csrf }, signal: AbortSignal.timeout(7000) }).then(async response => {
            if (!response.ok) return
            const profile = await response.json() as { picture?: string }
            if (current?.user && current.csrf === auth.csrf && profile.picture) { current.user.picture = profile.picture; document.dispatchEvent(new Event("jazu:profile")) }
        }).catch(() => {})
    }).catch(() => {})
    document.addEventListener("click", event => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-sign]")
        if (!button) return
        event.preventDefault()
        button.disabled = true
        void get_auth().then(async auth => {
            if (button.dataset.sign === "out") await sign_out()
            else if (button.dataset.sign === "delete") {
                if (auth.user && button.dataset.confirm && window.confirm(button.dataset.confirm)) await delete_account()
            } else if ((button.dataset.sign === "google" && !auth.user) || (button.dataset.sign === "drive" && auth.user)) {
                if (!auth.google_enabled) throw new Error("Google sign-in is not configured on this site")
                location.assign("/api/v1/auth/google/start" + (button.dataset.sign === "drive" ? "?drive=1" : ""))
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
