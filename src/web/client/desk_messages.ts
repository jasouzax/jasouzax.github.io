/*
 * Work messaging window: invitation import, owner room management, encrypted text and catch-up polling.
 * Invitation secrets live in URL fragments, then in this tab's session storage; never in desk/VFS state.
 * Unacknowledged sends retain the same encrypted envelope/id for safe explicit retries.
 */
import type { desk_window } from "./desk.ts"
import { text, refresh_tab } from "./desk.ts"
import { sync_navigation } from "./desk_navigation.ts"
import { encrypt_message, decrypt_message, encode_key, decode_key, type Work_Envelope } from "../../work_crypto.ts"

type Invitation = { room: string, token: string, key: string }
type Message = { seq: number, id: string, author: "owner" | "client", envelope: Work_Envelope, created_at: number }
type Room = { id: string, email: string, revoked?: number }
type Pending = { id: string, envelope: Work_Envelope, text: string }
const base = "/api/v1/work/rooms"
const invitations = new Map<string, Invitation>()
const pending = new Map<string, Pending>()
const drafts = new Map<string, string>()
const provisioning = new Map<string, Invitation>()
let owner_token = ""
const label = (key: string) => text(`work_${key}`)

function element<K extends keyof HTMLElementTagNameMap>(tag: K, value = "", name = ""): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag)
    node.textContent = value
    if (name) node.className = name
    return node
}

function button(value: string, action: () => void): HTMLButtonElement {
    const node = element("button", value)
    node.type = "button"
    node.addEventListener("click", action)
    return node
}

function field(form: HTMLElement, name: string, type = "text"): HTMLInputElement {
    const row = element("label", name)
    const input = element("input")
    input.type = type; input.required = true; input.autocomplete = "off"
    row.append(input); form.append(row)
    return input
}

function remember(invitation: Invitation): void {
    invitations.set(invitation.room, invitation)
    try { sessionStorage.setItem(`jazu_work_${invitation.room}`, JSON.stringify(invitation)); sessionStorage.setItem("jazu_work_active", invitation.room) } catch {}
}

function recalled(room: string): Invitation | null {
    if (invitations.has(room)) return invitations.get(room)!
    try {
        const data = sessionStorage.getItem(`jazu_work_${room}`)
        return data ? validate_invitation(JSON.parse(data)) : null
    } catch { return null }
}

function validate_invitation(value: Invitation): Invitation {
    if (!value || typeof value.room !== "string" || !/^[a-f0-9-]{36}$/i.test(value.room) || typeof value.token !== "string" || !/^[A-Za-z0-9_-]{32,256}$/.test(value.token) || typeof value.key !== "string" || decode_key(value.key).length !== 32) throw new Error(label("invalid_invitation"))
    return { room: value.room, token: value.token, key: value.key }
}

function import_invitation(value: string): Invitation {
    const url = new URL(value, location.origin)
    const fragment = new URLSearchParams(url.hash.slice(1))
    const invitation = validate_invitation({ room: fragment.get("room")!, token: fragment.get("token")!, key: fragment.get("key")! })
    remember(invitation)
    return invitation
}

function invitation_link(invitation: Invitation): string {
    return `${location.origin}/work#${new URLSearchParams(invitation).toString()}`
}

export function message_body(item: desk_window, signal: AbortSignal): HTMLElement {
    const root = element("section", "", "desk_messages")
    root.setAttribute("aria-label", label("messages"))
    if (!item.el.closest(".desk[data-server]")) {
        root.append(element("p", label("work_only")))
        return root
    }
    let current: AbortController | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let generation = 0
    const stop = () => { generation++; current?.abort(); clearTimeout(timer) }
    signal.addEventListener("abort", stop, { once: true })

    const api = async (path: string, token: string, body?: unknown, abort = signal): Promise<any> => {
        const response = await fetch(path, { method: body === undefined ? "GET" : "POST", credentials: "omit", cache: "no-store", signal: AbortSignal.any([abort, AbortSignal.timeout(15000)]), headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-jazu-work": "1" }, body: body === undefined ? undefined : JSON.stringify(body) })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error?.message ?? label("unavailable"))
        return data
    }
    const address = (email: string) => {
        item.path = `im:${email}`; item.name = email
        refresh_tab(item); sync_navigation(item)
    }
    const logout = () => {
        stop(); owner_token = ""; invitations.clear(); pending.clear(); drafts.clear(); provisioning.clear()
        try { for (const key of Object.keys(sessionStorage)) if (key.startsWith("jazu_work_")) sessionStorage.removeItem(key) } catch {}
        entry()
    }
    const error_text = (error: unknown) => error instanceof Error ? error.message : label("unavailable")

    const conversation = async (invitation: Invitation, token: string, owner: boolean): Promise<void> => {
        stop()
        try { sessionStorage.setItem("jazu_work_role", owner ? "owner" : "client") } catch {}
        current = new AbortController()
        const abort = AbortSignal.any([signal, current.signal])
        const revision = generation
        const status = element("p", label("connecting"), "desk_messages_status")
        status.setAttribute("role", "status")
        root.replaceChildren(status)
        try {
            const info = await api(`${base}/${invitation.room}`, token, undefined, abort)
            if (abort.aborted) return
            if ((info.role === "owner") !== owner) throw new Error(label("unavailable"))
            address(owner ? info.room.email : info.owner_email)
            const toolbar = element("div", "", "desk_messages_toolbar")
            const heading = element("strong", owner ? info.room.email : info.owner_email)
            toolbar.append(heading, button(label("lock"), logout))
            if (owner) toolbar.append(button(label("conversations"), () => void owner_rooms()))
            const note = element("p", label("encrypted"), "desk_messages_notice")
            const log = element("ol", "", "desk_messages_log")
            log.setAttribute("role", "log"); log.setAttribute("aria-label", label("messages")); log.setAttribute("aria-live", "polite")
            const empty = element("p", label("empty"), "desk_messages_empty")
            const composer = element("form", "", "desk_messages_composer")
            const input = element("textarea")
            input.setAttribute("aria-label", label("write")); input.placeholder = label("write"); input.rows = 3; input.maxLength = 8000
            input.value = drafts.get(invitation.room) ?? pending.get(invitation.room)?.text ?? ""
            const send = element("button", label(pending.has(invitation.room) ? "retry" : "send"))
            send.type = "submit"
            const hint = element("small", label("send_hint"))
            composer.append(input, send, hint)
            if (info.room.revoked) { input.disabled = true; send.disabled = true; note.textContent = label("closed") }
            root.replaceChildren(toolbar, note, empty, log, status, composer)
            if (owner) {
                const tools = element("details", "", "desk_messages_tools")
                tools.append(element("summary", label("invitation")))
                const backup = element("textarea")
                backup.readOnly = true; backup.rows = 3; backup.value = invitation.token ? invitation_link(invitation) : invitation.key
                backup.setAttribute("aria-label", label("invitation"))
                tools.append(element("p", label("backup")), backup, button(label("revoke"), () => {
                    void api(`${base}/${invitation.room}/revoke`, token, {}, abort).then(() => { input.disabled = true; send.disabled = true; note.textContent = label("closed") }).catch(error => { status.textContent = error_text(error) })
                }))
                root.append(tools)
            }
            let cursor = 0
            let delay = 5000
            let polling = false
            const seen = new Set<number>()
            const append = async (message: Message) => {
                if (seen.has(message.seq) || abort.aborted) return
                const row = element("li", "", `desk_message desk_message_${message.author}${message.author === (owner ? "owner" : "client") ? " desk_message_self" : ""}`)
                const meta = element("small", `${message.author === (owner ? "owner" : "client") ? label("you") : owner ? info.room.email : info.owner_email} · ${new Date(message.created_at).toLocaleString()}`)
                const body = element("p")
                try { body.textContent = await decrypt_message(invitation.key, message.envelope, { room: invitation.room, id: message.id, author: message.author }) }
                catch { body.textContent = label("decrypt_failed"); row.classList.add("desk_message_error") }
                if (abort.aborted) return
                const near_bottom = log.scrollHeight - log.scrollTop - log.clientHeight < 100
                row.append(meta, body); log.append(row); seen.add(message.seq); empty.hidden = true
                if (near_bottom) log.scrollTop = log.scrollHeight
            }
            const poll = async () => {
                if (polling || abort.aborted) return
                polling = true; clearTimeout(timer)
                try {
                    let more = true
                    while (more && !abort.aborted) {
                        const data = await api(`${base}/${invitation.room}/messages?after=${cursor}`, token, undefined, abort)
                        for (const message of data.messages as Message[]) { await append(message); cursor = Math.max(cursor, message.seq) }
                        more = data.more
                    }
                    if (!abort.aborted) { status.textContent = label(pending.has(invitation.room) ? "not_sent" : "connected"); delay = 5000 }
                } catch (error) {
                    if (!abort.aborted) { status.textContent = `${label("reconnecting")} ${error_text(error)}`; delay = Math.min(delay * 2, 30000) }
                } finally {
                    polling = false
                    if (!abort.aborted && revision === generation) timer = setTimeout(() => void poll(), delay)
                }
            }
            window.addEventListener("online", () => void poll(), { signal: abort })
            document.addEventListener("visibilitychange", () => { if (!document.hidden) void poll() }, { signal: abort })
            input.addEventListener("input", () => drafts.set(invitation.room, input.value))
            input.addEventListener("keydown", event => {
                if (event.key === "Enter" && !event.shiftKey && !event.isComposing && !send.disabled) { event.preventDefault(); composer.requestSubmit() }
            })
            composer.addEventListener("submit", event => {
                event.preventDefault()
                if (send.disabled || (!input.value.trim() && !pending.has(invitation.room))) return
                send.disabled = true; input.readOnly = true
                void (async () => {
                    try {
                        let message = pending.get(invitation.room)
                        if (!message) {
                            const id = crypto.randomUUID()
                            message = { id, text: input.value, envelope: await encrypt_message(invitation.key, input.value, { room: invitation.room, id, author: owner ? "owner" : "client" }) }
                            pending.set(invitation.room, message)
                        }
                        await api(`${base}/${invitation.room}/messages`, token, { id: message.id, envelope: message.envelope }, abort)
                        pending.delete(invitation.room); drafts.delete(invitation.room)
                        if (abort.aborted) return
                        input.value = ""; send.textContent = label("send"); status.textContent = label("sent")
                        await poll()
                    } catch (error) {
                        if (!abort.aborted) { status.textContent = `${label("not_sent")} ${error_text(error)}`; send.textContent = label("retry") }
                    } finally {
                        if (!abort.aborted) { send.disabled = false; input.readOnly = pending.has(invitation.room); input.focus() }
                    }
                })()
            })
            if (pending.has(invitation.room)) input.readOnly = true
            void poll()
        } catch (error) {
            if (!abort.aborted) root.replaceChildren(element("p", error_text(error)), button(label("back"), entry))
        }
    }

    const owner_rooms = async (): Promise<void> => {
        stop()
        const revision = generation
        const status = element("p", label("connecting"))
        root.replaceChildren(status)
        try {
            const data = await api(base, owner_token)
            if (signal.aborted || revision !== generation) return
            const heading = element("div", "", "desk_messages_toolbar")
            heading.append(element("strong", label("conversations")), button(label("lock"), logout))
            const list = element("ul", "", "desk_messages_rooms")
            for (const room of data.rooms as Room[]) {
                const row = element("li")
                row.append(button(room.email + (room.revoked ? ` (${label("closed")})` : ""), () => {
                    const saved = recalled(room.id)
                    if (saved) { void conversation(saved, owner_token, true); return }
                    const form = element("form")
                    const key = field(form, label("shared_key"), "password")
                    const submit = element("button", label("open")); submit.type = "submit"
                    form.append(submit)
                    form.addEventListener("submit", event => {
                        event.preventDefault()
                        try {
                            let invitation: Invitation
                            if (key.value.includes("#")) invitation = import_invitation(key.value)
                            else { if (decode_key(key.value).length !== 32) throw new Error(label("invalid_invitation")); invitation = { room: room.id, token: "", key: key.value } }
                            if (invitation.room !== room.id) throw new Error(label("invalid_invitation"))
                            invitations.set(room.id, invitation)
                            void conversation(invitation, owner_token, true)
                        } catch (error) { status.textContent = error_text(error) }
                    })
                    row.replaceChildren(element("strong", room.email), form); key.focus()
                }))
                list.append(row)
            }
            const form = element("form", "", "desk_messages_create")
            const email = field(form, label("client_email"), "email")
            const create = element("button", label("create")); create.type = "submit"
            form.append(create)
            form.addEventListener("submit", event => {
                event.preventDefault(); create.disabled = true
                // Generate before provisioning so a failed crypto context cannot create a keyless room.
                void (async () => {
                    const client_email = email.value.trim().toLowerCase()
                    let invitation = provisioning.get(client_email)
                    if (!invitation) {
                        invitation = { room: crypto.randomUUID(), token: encode_key(crypto.getRandomValues(new Uint8Array(32))), key: encode_key(crypto.getRandomValues(new Uint8Array(32))) }
                        provisioning.set(client_email, invitation)
                    }
                    // Save the key before the request: a lost provisioning acknowledgement must not lose access.
                    remember(invitation)
                    try { sessionStorage.setItem("jazu_work_role", "owner") } catch {}
                    await api(base, owner_token, { email: client_email, id: invitation.room, token: invitation.token })
                    provisioning.delete(client_email)
                    if (!signal.aborted && revision === generation) await conversation(invitation, owner_token, true)
                })().catch(error => { status.textContent = error_text(error); create.disabled = false })
            })
            status.textContent = label("owner_help")
            root.replaceChildren(heading, status, list, form)
        } catch (error) {
            if (!signal.aborted && revision === generation) root.replaceChildren(element("p", error_text(error)), button(label("back"), entry))
        }
    }

    const entry = (): void => {
        stop()
        const intro = element("p", label("welcome"))
        const status = element("p")
        status.setAttribute("role", "status")
        const form = element("form")
        const invitation = field(form, label("invitation"), "password")
        const open = element("button", label("open")); open.type = "submit"; form.append(open)
        form.addEventListener("submit", event => {
            event.preventDefault()
            try { const data = import_invitation(invitation.value); void conversation(data, data.token, false) }
            catch (error) { status.textContent = error_text(error) }
        })
        const owner = element("details")
        owner.append(element("summary", label("owner_access")))
        const login = element("form")
        const token = field(login, label("owner_token"), "password")
        const connect = element("button", label("connect")); connect.type = "submit"; login.append(connect)
        login.addEventListener("submit", event => { event.preventDefault(); owner_token = token.value.trim(); token.value = ""; void owner_rooms() })
        owner.append(login)
        root.replaceChildren(element("h2", label("messages")), intro, form, status, owner)
    }

    if (!globalThis.isSecureContext || !crypto.subtle) { root.append(element("p", label("secure_context"))); return root }
    try {
        if (location.hash.startsWith("#room=")) {
            const value = location.href
            history.replaceState(history.state, "", location.pathname + location.search)
            const invitation = import_invitation(value)
            void conversation(invitation, invitation.token, false)
        } else if (owner_token) void owner_rooms()
        else {
            let active = ""
            try { active = sessionStorage.getItem("jazu_work_active") ?? "" } catch {}
            const invitation = recalled(active)
            let role = "client"
            try { role = sessionStorage.getItem("jazu_work_role") ?? "client" } catch {}
            if (invitation?.token && role !== "owner") void conversation(invitation, invitation.token, false)
            else entry()
        }
    } catch { entry() }
    return root
}
