/*
 * Server-backed Google identity. Provider tokens never enter browser persistent storage.
 * Short-lived Drive access lives in memory; guest keys remain local until Google sign-in saves them to Drive or encrypted client recovery storage.
 */
export type Auth_State = { user: { email: string, name: string, picture?: string, role: "owner" | "client", step_up?: boolean } | null, csrf: string, google_enabled: boolean }
let current: Auth_State | null = null
let pending: Promise<Auth_State> | null = null
let revision = 0

export function get_auth(refresh = false): Promise<Auth_State> {
    if (refresh) { pending = null; revision++ }
    const request_revision = revision
    return pending ??= fetch(`/api/_/session${refresh ? "?fresh=1" : ""}`, { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(10000) }).then(async response => {
        if (!response.ok) throw new Error("Sign-in service is unavailable")
        const value = await response.json() as Auth_State
        if (request_revision !== revision) return get_auth()
        current = value
        return current
    }).catch(error => { if (request_revision === revision) pending = null; throw error })
}

function paint(): void {
    const signed_in = Boolean(current?.user)
    for (const item of document.querySelectorAll<HTMLElement>("[data-auth]")) item.hidden = (item.dataset.auth === "user") !== signed_in
}

function clear_identity(google_enabled: boolean): void {
    revision++
    current = { user: null, csrf: "", google_enabled }
    pending = Promise.resolve(current)
    try { for (const key of Object.keys(sessionStorage)) if (key.startsWith("jazu_work_")) sessionStorage.removeItem(key) } catch {}
    paint()
    document.dispatchEvent(new Event("jazu:signed-out"))
    document.dispatchEvent(new Event("jazu:auth"))
}

export async function sign_out(): Promise<void> {
    const auth = await get_auth()
    if (auth.user) {
        const response = await fetch("/api/_/auth/logout", { method: "POST", credentials: "same-origin", headers: { "x-jazu-work": "1", "x-jazu-csrf": auth.csrf }, signal: AbortSignal.timeout(10000) })
        if (!response.ok) throw new Error("Could not sign out; please try again")
    }
    clear_identity(auth.google_enabled)
}

async function delete_account(): Promise<void> {
    const auth = await get_auth()
    if (!auth.user) throw new Error("Sign in before deleting your account")
    await (await import("./passkeys.ts")).sensitive_auth()
    const response = await fetch("/api/_/auth/account/delete", { method: "POST", credentials: "same-origin", headers: { "x-jazu-work": "1", "x-jazu-csrf": auth.csrf, "x-jazu-confirm-delete": "account" }, signal: AbortSignal.timeout(15000) })
    if (!response.ok) throw new Error("Could not delete the account; please try again")
    clear_identity(auth.google_enabled)
}

let login_window: Window | null = null
let login_timer = 0
export function google_sign_in(drive = false, filesystem = false): void {
    if (login_window && !login_window.closed) { login_window.focus(); return }
    // Open synchronously inside the click activation, before any asynchronous session lookup.
    login_window = window.open(`/api/_/auth/google/start${filesystem ? "?filesystem=1" : drive ? "?drive=1" : ""}`, "jazu-google-login", "popup,width=520,height=720")
    if (!login_window) throw new Error("Allow popups for this site to sign in with Google")
    clearInterval(login_timer)
    const until = Date.now() + 600000
    login_timer = window.setInterval(() => {
        if (!login_window || login_window.closed || Date.now() > until) {
            clearInterval(login_timer); login_window = null
            void refresh_identity().catch(() => {})
        }
    }, 500)
}
async function refresh_identity(): Promise<void> {
    await get_auth(true); paint(); document.dispatchEvent(new Event("jazu:auth"))
}

export function init_sign(): void {
    const completed = (data: { type?: string, error?: string }) => {
        if (data?.type !== "jazu:oauth") return
        clearInterval(login_timer); login_window = null
        void refresh_identity().catch(() => {})
        if (data.error) {
            const notice = document.createElement("p"); notice.setAttribute("role", "alert")
            notice.textContent = `Google sign-in: ${data.error}`
            document.querySelector("[data-sign=google]")?.after(notice)
        }
    }
    window.addEventListener("message", event => {
        if (event.origin === location.origin && event.source === login_window) completed(event.data)
    })
    try { const channel = new BroadcastChannel("jazu:oauth"); channel.onmessage = event => completed(event.data) } catch {}
    // Retire the former unverified, browser-only profile cache.
    try { localStorage.removeItem("jazu_user"); sessionStorage.removeItem("jazu_nonce") } catch {}
    void get_auth().then(auth => {
        paint(); document.dispatchEvent(new Event("jazu:auth"))
        if (auth.user && !auth.user.picture) void fetch("/api/_/auth/profile", { method: "POST", credentials: "same-origin", headers: { "x-jazu-work": "1", "x-jazu-csrf": auth.csrf }, signal: AbortSignal.timeout(7000) }).then(async response => {
            if (!response.ok) return
            const profile = await response.json() as { picture?: string }
            if (current?.user && current.csrf === auth.csrf && profile.picture) { current.user.picture = profile.picture; document.dispatchEvent(new Event("jazu:profile")) }
        }).catch(() => {})
    }).catch(() => {})
    document.addEventListener("click", event => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-sign]")
        if (!button) return
        event.preventDefault()
        if (button.dataset.sign === "google" || button.dataset.sign === "drive") {
            try { google_sign_in(button.dataset.sign === "drive") }
            catch (error) { const notice = document.createElement("p"); notice.setAttribute("role", "alert"); notice.textContent = (error as Error).message; button.after(notice) }
            return
        }
        button.disabled = true
        void get_auth().then(async auth => {
            if (button.dataset.sign === "out") await sign_out()
            else if (button.dataset.sign === "passkeys" && auth.user) (await import("./passkeys.ts")).open_passkeys()
            else if (button.dataset.sign === "delete") {
                if (auth.user && button.dataset.confirm && window.confirm(button.dataset.confirm)) await delete_account()
            }
        }).catch(error => {
            const status = document.createElement("p")
            status.setAttribute("role", "alert")
            status.textContent = error instanceof Error ? error.message : "Sign-in is unavailable"
            button.after(status)
        }).finally(() => { button.disabled = false })
    })
    document.addEventListener("jazu:page", paint)
    document.addEventListener("jazu:auth", paint)
}
