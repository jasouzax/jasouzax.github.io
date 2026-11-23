/* Optional passkey settings and explicit verification; credentials never enter local/session storage. */
import { startRegistration, startAuthentication } from "@simplewebauthn/browser"
import { get_auth } from "./sign.ts"
type Key_Status = { keys: { id: string, name: string, created_at: number }[], recent: boolean, owner_locked: boolean }
async function call(path: string, body?: unknown): Promise<any> {
    const auth = await get_auth()
    const response = await fetch(`/api/_/auth/passkeys${path}`, { method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json", "x-jazu-work": "1", "x-jazu-csrf": auth.csrf }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error?.message || data.message || "Passkey request failed")
    return data
}
export async function verify_passkey(): Promise<void> {
    const optionsJSON = await call("/verify/options", {})
    const credential = await startAuthentication({ optionsJSON })
    await call("/verify", { credential })
    await get_auth(true)
    document.dispatchEvent(new Event("jazu:auth"))
}
export async function sensitive_auth(): Promise<void> {
    const status = await call("") as Key_Status
    if (status.recent) return
    if (!status.keys.length) { open_passkeys(); throw new Error("Sign in with Google again before deleting your account. Your account has not been deleted.") }
    await verify_passkey()
}
export function open_passkeys(): void {
    if (document.querySelector("dialog[data-passkeys]")) return
    const dialog = document.createElement("dialog"), title = document.createElement("h2"), content = document.createElement("div"), status = document.createElement("p")
    dialog.dataset.passkeys = ""; dialog.setAttribute("aria-labelledby", "passkeys-title")
    title.id = "passkeys-title"; title.textContent = "Passkeys"; status.setAttribute("role", "status")
    const supported = typeof PublicKeyCredential !== "undefined" && window.isSecureContext
    const explain = document.createElement("p")
    explain.textContent = "Passkeys are optional. Once added, they protect account deletion and owner access on new sessions. Keep a second passkey as a backup."
    const sign_in = document.createElement("a"); sign_in.href = "/api/_/auth/google/start"; sign_in.textContent = "Sign in with Google again"
    const button = (label: string, action: () => Promise<void>, parent: HTMLElement = dialog) => {
        const node = document.createElement("button"); node.type = "button"; node.textContent = label
        node.addEventListener("click", () => { node.disabled = true; status.textContent = ""; void action().catch(error => { status.textContent = error.name === "NotAllowedError" ? "Passkey request cancelled" : error.message }).finally(() => { node.disabled = false }) }); parent.append(node); return node
    }
    const refresh = async () => {
        const value = await call("") as Key_Status
        content.replaceChildren()
        if (value.owner_locked) { const note = document.createElement("p"); note.textContent = "Verify a passkey to unlock owner access in this session."; content.append(note) }
        if (!value.keys.length) { const note = document.createElement("p"); note.textContent = "No passkeys registered"; content.append(note) }
        for (const key of value.keys) {
            const row = document.createElement("p"); row.append(document.createTextNode(`${key.name} · ${new Date(key.created_at).toLocaleDateString()} `))
            button("Remove", async () => {
                if (!window.confirm(`Remove ${key.name}?${value.keys.length === 1 ? " This disables passkey protection." : ""}`)) return
                await verify_passkey(); await call("/remove", { id: key.id }); await refresh()
            }, row)
            content.append(row)
        }
    }
    dialog.append(title, explain, content, status, sign_in)
    const add = button("Add passkey", async () => {
        const value = await call("") as Key_Status
        if (!value.recent && value.keys.length) await verify_passkey()
        const optionsJSON = await call("/register/options", {})
        const credential = await startRegistration({ optionsJSON })
        await call("/register", { credential, name: "Passkey" }); await get_auth(true); await refresh(); status.textContent = "Passkey added"
    })
    const verify = button("Verify passkey", async () => { const value = await call("") as Key_Status; await verify_passkey(); status.textContent = "Passkey verified"; await refresh(); if (value.owner_locked) location.reload() })
    add.disabled = verify.disabled = !supported
    if (!supported) status.textContent = "Passkeys require a supported browser on a secure origin"
    button("Close", async () => { dialog.close() })
    dialog.addEventListener("close", () => dialog.remove(), { once: true })
    document.body.append(dialog); dialog.showModal()
    void refresh().catch(error => { status.textContent = error.message })
}
