// "Sign in with Google": opens Google's own sign-in in a popup window.
// With a client id (jazu.config.ts -> google_client_id, written on the button as data-client) this is the OpenID Connect implicit flow:
// the popup returns to this site with an id_token in the fragment, which is read here (the popup is same-origin again by then),
// checked against the nonce, and its name / email / picture are kept in localStorage. Without a client id the popup opens Google's account
// chooser, so the button still goes to Google. The redirect uri (origin + "/") must be listed on the Google Cloud OAuth client.

const store_key = "jazu_user"
const nonce_key = "jazu_nonce"

type user = { name: string, email: string, picture: string, exp: number }

function read_user(): user | null {
    try {
        const raw = localStorage.getItem(store_key)
        if (!raw) return null
        const value = JSON.parse(raw) as user
        if (value.exp * 1000 < Date.now()) {
            localStorage.removeItem(store_key)
            return null
        }
        return value
    } catch {
        return null
    }
}

function write_user(value: user | null): void {
    try {
        if (value) localStorage.setItem(store_key, JSON.stringify(value))
        else localStorage.removeItem(store_key)
    } catch { /* storage blocked: the sign-in just lasts until reload */ }
}

function decode_jwt(token: string): Record<string, unknown> | null {
    const part = token.split(".")[1]
    if (!part) return null
    try {
        const base64 = part.replace(/-/g, "+").replace(/_/g, "/")
        const bytes = Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")), char => char.charCodeAt(0))
        return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>
    } catch {
        return null
    }
}

function random_nonce(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(16))
    return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("")
}

function popup_features(): string {
    const width = 480
    const height = 640
    const left = Math.round(screenX + (outerWidth - width) / 2)
    const top = Math.round(screenY + (outerHeight - height) / 2)
    return `popup=yes,width=${width},height=${height},left=${left},top=${top}`
}

function accept(fragment: string): boolean {
    const params = new URLSearchParams(fragment.replace(/^#/, ""))
    const token = params.get("id_token")
    if (!token) return false
    const claims = decode_jwt(token)
    const expected = sessionStorage.getItem(nonce_key)
    if (!claims || !expected || claims.nonce !== expected) return false
    sessionStorage.removeItem(nonce_key)
    write_user({
        name: String(claims.name ?? claims.email ?? ""),
        email: String(claims.email ?? ""),
        picture: String(claims.picture ?? ""),
        exp: Number(claims.exp ?? 0),
    })
    return true
}

function paint(): void {
    const current = read_user()
    for (const button of document.querySelectorAll<HTMLButtonElement>("button[data-sign]")) {
        const text = button.querySelector<HTMLElement>(".sign_text")
        if (!text) continue
        const idle = button.dataset.idle ?? text.textContent ?? ""
        button.dataset.idle = idle
        button.dataset.signed = current ? "out" : "in"
        text.textContent = current ? `${button.dataset.outText ?? "Sign out"} (${current.name})` : idle
        button.title = current ? current.email : ""
    }
}

function open_popup(button: HTMLButtonElement): void {
    const client = button.dataset.client ?? ""
    if (!client) {
        window.open("https://accounts.google.com/AccountChooser", "jazu_sign", popup_features())
        return
    }
    const nonce = random_nonce()
    try {
        sessionStorage.setItem(nonce_key, nonce)
    } catch {
        return
    }
    const query = new URLSearchParams({
        client_id: client,
        redirect_uri: `${location.origin}/`,
        response_type: "id_token",
        response_mode: "fragment",
        scope: "openid email profile",
        nonce,
        prompt: "select_account",
    })
    const popup = window.open(`https://accounts.google.com/o/oauth2/v2/auth?${query}`, "jazu_sign", popup_features())
    if (!popup) {
        // popup blocked: the same flow in this tab; init_sign picks the fragment up when Google sends the reader back
        location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${query}`)
        return
    }
    const timer = window.setInterval(() => {
        if (popup.closed) {
            clearInterval(timer)
            return
        }
        let fragment = ""
        try {
            // cross-origin (still on Google) throws; once it is back on this origin the fragment is readable
            fragment = popup.location.origin === location.origin ? popup.location.hash : ""
        } catch {
            return
        }
        if (!fragment) return
        clearInterval(timer)
        const ok = accept(fragment)
        popup.close()
        if (ok) paint()
    }, 300)
}

export function init_sign(): void {
    // came back into this very tab (popup blocked): the fragment carries the token
    if (location.hash.startsWith("#id_token=") && accept(location.hash)) history.replaceState(null, "", location.pathname + location.search)
    paint()
    document.addEventListener("click", event => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-sign=\"google\"]")
        if (!button) return
        event.preventDefault()
        if (read_user()) {
            write_user(null)
            paint()
            return
        }
        open_popup(button)
    })
    // a page swap (client_spa) brings a fresh menu
    document.addEventListener("jazu:page", paint)
    addEventListener("storage", event => {
        if (event.key === store_key) paint()
    })
}
