/* Direct encrypted chat: browser guests, private Drive keys and owner-only client navigation. */
import type { desk_window } from "./desk.ts"
import { text, refresh_tab, state, new_window, focus_window, toggle_maximize } from "./desk.ts"
import { open_source } from "./desk_view.ts"
import { sync_navigation } from "./desk_navigation.ts"
import { encrypt_message, decrypt_message, unwrap_room_key, type Work_Envelope } from "../../work_crypto.ts"
import { work_context, work_api, prepare_conversation, type Work_Context, type Work_Room } from "./work_session.ts"
import type { Client_Key } from "./work_drive.ts"
import { google_picture } from "../../work_profile.ts"
import { get_auth } from "./sign.ts"
import { acquire_guest, realtime_connected, realtime_replaced, realtime_ready, realtime_request, watch_conversation } from "./realtime.ts"

type Message = { seq: number, id: string, author: "owner" | "client", envelope: Work_Envelope, created_at: number }
type Pending = { id: string, envelope: Work_Envelope, text: string }
const pending = new Map<string, Pending>()
const drafts = new Map<string, string>()
const label = (key: string) => text(`work_${key}`)
const base = "/api/v1/work/rooms"
let identity = ""
let panel_timer: ReturnType<typeof setTimeout> | undefined
let panel_revision = 0
let panel_abort: AbortController | undefined
const error_text = (error: unknown) => error instanceof Error ? error.message : label("unavailable")
function element<K extends keyof HTMLElementTagNameMap>(tag: K, value = "", name = ""): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag); node.textContent = value
    if (name) node.className = name
    return node
}
function button(value: string, action: () => void): HTMLButtonElement {
    const node = element("button", value); node.type = "button"; node.addEventListener("click", action); return node
}
function avatar(picture = "", class_name = "desk_profile_avatar"): HTMLElement {
    const node = element("span", "", class_name)
    node.setAttribute("aria-hidden", "true")
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    icon.setAttribute("viewBox", "0 0 24 24")
    const head = document.createElementNS(icon.namespaceURI, "circle"); head.setAttribute("cx", "12"); head.setAttribute("cy", "8"); head.setAttribute("r", "4")
    const shoulders = document.createElementNS(icon.namespaceURI, "path"); shoulders.setAttribute("d", "M3 23v-2a9 9 0 0 1 18 0v2")
    icon.append(head, shoulders); node.append(icon)
    const source = google_picture(picture)
    if (source) {
        const image = element("img"); image.src = source; image.alt = ""; image.referrerPolicy = "no-referrer"; image.loading = "lazy"; image.decoding = "async"
        image.addEventListener("load", () => { icon.style.visibility = "hidden" })
        image.addEventListener("error", () => { image.remove(); icon.style.visibility = "visible" }, { once: true })
        node.append(image)
    }
    return node
}
function account_controls(toolbar: HTMLElement, context: Work_Context): void {
    if (!context.auth.user) {
        if (context.auth.google_enabled) { const login = element("button", label("google_signin")); login.dataset.sign = "google"; toolbar.append(login) }
        return
    }
    const out = element("button", text("sign_out_google")); out.dataset.sign = "out"
    const remove = element("button", text("delete_account")); remove.dataset.sign = "delete"; remove.dataset.confirm = text("delete_account_confirm")
    toolbar.append(out, remove)
}
async function rooms(context: Work_Context): Promise<Work_Room[]> {
    const result: Work_Room[] = []
    let next: string | null = null
    do {
        const data = await work_api(base + (next ? `?before=${encodeURIComponent(next)}` : ""), context.csrf)
        result.push(...data.rooms); next = data.next
    } while (next)
    return result
}
function clients_panel(context: Work_Context): void {
    const desk = state.desk
    if (!desk?.hasAttribute("data-server")) return
    const aside = desk.querySelector<HTMLElement>(".desk_side")
    const tabs = aside?.querySelector(".desk_side_tabs_ul")
    if (!aside || !tabs || aside.querySelector("[data-work-clients]")) return
    panel_abort?.abort(); panel_abort = new AbortController()
    const panel_signal = panel_abort.signal
    const revision = ++panel_revision
    const side_toggle = document.querySelector<HTMLDetailsElement>("#head_menu")
    if (side_toggle) side_toggle.open = true
    const tab = element("li")
    const details = element("details", "", "desk_side_tabs_drop"); details.name = "desk_side_tab"; details.dataset.path = "im:clients"
    details.append(element("summary", label("clients"))); tab.append(details); tabs.append(tab)
    const page = element("div", "", "desk_side_page"); page.dataset.workClients = ""; page.dataset.path = "im:clients"; page.style.display = "block"; page.hidden = true
    page.setAttribute("role", "feed"); page.setAttribute("aria-label", label("clients"))
    const status = element("p"); status.setAttribute("role", "status")
    const entries = element("div", "", "desk_clients_entities")
    const guest_entity = element("article", "", "desk_side_item"); guest_entity.dataset.kind = "dir"
    const guests = element("details", "", "desk_side_item_box"); guests.dataset.workGuests = ""
    const guest_head = element("summary", "", "desk_side_item_head")
    guest_head.append(element("span", state.data?.folder_icon ?? "", "desk_side_item_icon"), element("h3", label("guests"), "desk_side_item_name"))
    const guest_count = element("span", "0", "desk_side_item_code"); guest_head.append(guest_count)
    const guest_entries = element("div", "", "desk_side_item_sub"); guests.append(guest_head, guest_entries); guest_entity.append(guests)
    entries.append(guest_entity); page.append(status, entries); aside.append(page)
    const sync = () => { for (const entry of aside.querySelectorAll<HTMLElement>(".desk_side_page")) entry.hidden = entry === page ? !details.open : details.open }
    details.addEventListener("toggle", sync)
    for (const other of aside.querySelectorAll<HTMLDetailsElement>(".desk_side_tabs_drop")) if (other !== details) other.addEventListener("toggle", sync)
    const open = (room: Work_Room) => {
        const uri = `im:${room.email}`
        const focus = (item: desk_window) => { if (state.maximized && state.maximized !== item) toggle_maximize(item); else focus_window(item) }
        const existing = state.windows.find(item => item.path === uri)
        if (existing) { focus(existing); return }
        const item = new_window(); if (item) { focus(item); void open_source(item, uri) }
    }
    let signature = ""
    const refresh = async () => {
        if (!desk.isConnected || revision !== panel_revision) return
        try {
            const all = await rooms(context)
            if (!desk.isConnected || revision !== panel_revision) return
            const updated = JSON.stringify(all.map(room => [room.id, room.email, room.name, room.picture, room.revoked]))
            if (updated !== signature) {
                signature = updated
                guest_entries.replaceChildren(); for (const entry of [...entries.children]) if (entry !== guest_entity) entry.remove()
                guest_count.textContent = String(all.filter(room => room.email.startsWith("guest/")).length)
                for (const room of all) {
                    const row = element("article", "", "desk_side_item desk_client_entity"); row.dataset.kind = "contact"
                    const box = element("details", "", "desk_side_item_box"), head = element("summary", "", "desk_side_item_head")
                    const name = room.email.startsWith("guest/") ? `${label("guest")} ${room.guest_id}` : room.name || room.email
                    const title = element("h3", "", "desk_side_item_name"), link = element("button", name)
                    link.type = "button"; link.setAttribute("aria-label", room.email); title.append(link)
                    head.append(avatar(room.picture, "desk_side_item_icon desk_profile_avatar"), title, element("span", room.email, "desk_side_item_code"))
                    head.addEventListener("click", event => { event.preventDefault(); open(room) })
                    box.append(head); row.append(box)
                    if (room.email.startsWith("guest/")) guest_entries.append(row); else entries.append(row)
                }
            }
            status.textContent = all.length ? "" : label("no_clients")
        } catch (error) { if (revision === panel_revision) status.textContent = error_text(error) }

    }
    const refresh_live = () => {
        if (!desk.isConnected) { panel_abort?.abort(); return }
        clearTimeout(panel_timer); panel_timer = setTimeout(() => void refresh(), 50)
    }
    document.addEventListener("jazu:realtime", event => { if (["notification", "conversation-updated"].includes((event as CustomEvent).detail.type)) refresh_live() }, { signal: panel_signal })
    document.addEventListener("jazu:realtime-state", refresh_live, { signal: panel_signal })
    document.addEventListener("jazu:page", refresh_live, { signal: panel_signal })
    details.open = true; sync(); void refresh()
}
function remove_panel(): void {
    panel_revision++; clearTimeout(panel_timer); panel_abort?.abort()
    const aside = state.desk?.querySelector(".desk_side")
    aside?.querySelector('[data-path="im:clients"]')?.closest("li")?.remove()
    aside?.querySelector("[data-work-clients]")?.remove()
    for (const page of aside?.querySelectorAll<HTMLElement>(".desk_side_page") ?? []) page.hidden = false
}

export function message_body(item: desk_window, signal: AbortSignal): HTMLElement {
    const root = element("section", "", "desk_messages"); root.setAttribute("aria-label", label("messages"))
    if (!item.el.closest(".desk[data-server]")) { root.append(element("p", label("work_only"))); return root }
    let current: AbortController | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let generation = 0
    let unsent = ""
    const stop = () => { generation++; current?.abort(); clearTimeout(timer) }
    signal.addEventListener("abort", stop, { once: true })
    const initialize = async () => {
        stop()
        const revision = generation
        current = new AbortController()
        const abort = AbortSignal.any([signal, current.signal])
        const toolbar = element("div", "", "desk_messages_toolbar")
        const connection = element("span", label("connecting"), "desk_messages_connection"); connection.setAttribute("role", "status"); connection.title = label("connection_hint")
        const heading = element("strong", "jason@jasouza.com", "visually_hidden")
        const identity_status = element("span", "", "desk_messages_identity")
        toolbar.append(connection, heading, identity_status)
        let peer: { online: boolean, last_online: number | null } | undefined
        const render_presence = () => {
            connection.title = peer ? label("presence_hint") : label("connection_hint")
            connection.dataset.online = String(Boolean(peer?.online && realtime_connected()))
            if (!realtime_connected()) connection.textContent = label(realtime_replaced() ? "other_tab" : "reconnecting")
            else if (!peer) connection.textContent = label("live_connected")
            else if (peer.online) connection.textContent = label("online")
            else if (peer.last_online) {
                const minutes = Math.max(1, Math.floor((Date.now() - peer.last_online) / 60000))
                const time = new Intl.RelativeTimeFormat(document.documentElement.lang || "en", { numeric: "always" }).format(-minutes, "minute")
                connection.textContent = label("last_online").replace("{time}", time)
            } else connection.textContent = label("offline")
        }
        const tick_presence = () => { render_presence(); timer = setTimeout(tick_presence, 30000) }
        tick_presence()
        const notice = element("p", label("encrypted"), "desk_messages_notice")
        const warning = element("p"); warning.setAttribute("role", "alert"); warning.hidden = true
        const status = element("p", "", "desk_messages_status"); status.setAttribute("role", "status")
        const empty = element("p", label("empty"), "desk_messages_empty")
        const log = element("ol", "", "desk_messages_log"); log.setAttribute("role", "log"); log.setAttribute("aria-label", label("messages")); log.setAttribute("aria-live", "polite")
        const composer = element("form", "", "desk_messages_composer")
        const account = element("details", "", "desk_messages_account")
        const account_head = element("summary"); account_head.setAttribute("aria-label", label("your_account")); account_head.append(avatar())
        const account_menu = element("div", "", "desk_messages_account_menu"); account.append(account_head, account_menu)
        const input = element("textarea"); input.rows = 1; input.maxLength = 8000; input.placeholder = label("write"); input.setAttribute("aria-label", label("write")); input.title = label("send_hint")
        input.value = unsent
        const send = element("button", "", "desk_messages_send"); send.type = "submit"; send.setAttribute("aria-label", label("send")); send.title = label("send")
        const send_icon = document.createElementNS("http://www.w3.org/2000/svg", "svg"); send_icon.setAttribute("viewBox", "0 0 24 24"); send_icon.setAttribute("aria-hidden", "true")
        const arrow = document.createElementNS(send_icon.namespaceURI, "path"); arrow.setAttribute("d", "M3 3 22 12 3 21l3-8 10-1-10-1Z"); send_icon.append(arrow); send.append(send_icon)
        const send_label = (retry = false) => { const value = label(retry ? "retry" : "send"); send.setAttribute("aria-label", value); send.title = value; send.dataset.retry = String(retry) }
        const resize_input = () => { input.style.height = "auto"; input.style.height = `${Math.min(input.scrollHeight, 112)}px` }
        composer.append(account, input, send)
        root.replaceChildren(toolbar, notice, warning, empty, log, status, composer)
        let context: Work_Context | undefined
        let key: Client_Key | undefined
        let owner = false
        let cursor = 0
        let fetching = false, initialized = false
        let watched = "", watch_abort: AbortController | undefined, watch_signal: AbortSignal | undefined
        abort.addEventListener("abort", () => watch_abort?.abort(), { once: true })
        let updates: Promise<void> = Promise.resolve()
        const seen = new Set<number>()
        let requested = item.path.slice(3)
        const address = (value: string) => { item.path = `im:${value}`; item.name = value; refresh_tab(item); sync_navigation(item); heading.textContent = value; root.setAttribute("aria-label", `${label("messages")}: ${value}`) }
        const storage_status = (context: Work_Context) => {
            identity_status.replaceChildren()
            notice.textContent = label(context.storage === "fallback" ? "fallback_notice" : "encrypted")
            if (context.auth.user && context.storage === "fallback") {
                const consent = element("button", label("drive_for_e2e")); consent.dataset.sign = "drive"; identity_status.append(consent)
            } else if (context.auth.user) identity_status.textContent = label("google_signed_in")
            else if (context.auth.google_enabled) {
                const save = element("button", label("signin_save")); save.dataset.sign = "google"; save.setAttribute("aria-label", label("google_signin")); identity_status.append(save)
            }
        }
        const append = async (message: Message) => {
            if (!key || seen.has(message.seq) || abort.aborted) return
            const row = element("li", "", `desk_message desk_message_${message.author}${message.author === (owner ? "owner" : "client") ? " desk_message_self" : ""}`)
            const meta = element("div", "", "desk_message_meta")
            const sent_at = new Date(message.created_at), timestamp = element("time"); timestamp.dateTime = sent_at.toISOString()
            timestamp.append(element("span", sent_at.toLocaleDateString(document.documentElement.lang || undefined, { day: "numeric", month: "short", year: "numeric" }), "desk_message_date"), element("span", sent_at.toLocaleTimeString(document.documentElement.lang || undefined, { hour: "2-digit", minute: "2-digit" }), "desk_message_time"))
            meta.append(element("span", message.author === (owner ? "owner" : "client") ? label("you") : heading.textContent ?? "", "visually_hidden"), timestamp)
            const body = element("p", "", "desk_message_body")
            try { body.textContent = await decrypt_message(key.key, message.envelope, { room: key.room, id: message.id, author: message.author }) }
            catch { body.textContent = label("decrypt_failed"); row.classList.add("desk_message_error") }
            if (abort.aborted) return
            const near_bottom = log.scrollHeight - log.scrollTop - log.clientHeight < 100
            row.dataset.seq = String(message.seq)
            row.append(meta, body); log.insertBefore(row, [...log.children].find(child => Number((child as HTMLElement).dataset.seq) > message.seq) ?? null); seen.add(message.seq); empty.hidden = true
            if (near_bottom) log.scrollTop = log.scrollHeight
        }
        const apply_messages = (messages: Message[], advance = true) => {
            updates = updates.then(async () => { for (const message of messages) { await append(message); if (advance) cursor = Math.max(cursor, message.seq) } }).catch(() => {})
            return updates
        }
        const catch_up = async () => {
            if (!context || !key || fetching || abort.aborted) return
            fetching = true
            try {
                let more = true
                while (more && !abort.aborted) {
                    const data = await work_api(`${base}/${key.room}/messages?after=${cursor}`, context.csrf, undefined, abort)
                    await apply_messages(data.messages); more = data.more
                }
                if (!abort.aborted) status.textContent = pending.has(key.room) ? label("not_sent") : ""
            } catch (error) { if (!abort.aborted) status.textContent = `${label("reconnecting")} ${error_text(error)}` }
            finally { fetching = false }
        }
        const watch_live = async () => {
            if (!initialized || !context || context.error || abort.aborted || (owner && !key)) return
            await realtime_ready(abort)
            if (key) await catch_up()
            const conversation = key?.room ?? "owner"
            if (watched !== conversation || !watch_abort) { watch_abort?.abort(); watch_abort = new AbortController(); watch_signal = AbortSignal.any([abort, watch_abort.signal]); watched = conversation }
            const subscription = await watch_conversation("work", conversation, cursor, watch_signal!)
            if (!abort.aborted) { peer = subscription.presence; render_presence() }
        }
        document.addEventListener("jazu:realtime-state", () => { render_presence(); if (realtime_connected()) void watch_live().catch(error => { if (!abort.aborted) status.textContent = error_text(error) }) }, { signal: abort })
        document.addEventListener("jazu:realtime", event => {
            const data = (event as CustomEvent).detail
            if (data.channel !== "work" || abort.aborted) return
            if (data.type === "presence" && data.conversation === watched) { peer = data; render_presence() }
            if (data.conversation !== key?.room) return
            if (data.type === "messages") void apply_messages(data.messages)
            if (data.type === "catchup") void catch_up()
            if (["notification", "conversation-updated"].includes(data.type) && owner && data.address) { address(data.address); if (data.type === "conversation-updated") void watch_live().catch(() => {}) }
        }, { signal: abort })
        document.addEventListener("jazu:incoming-message", event => {
            if ((event as CustomEvent).detail.conversation === key?.room && !document.hidden && root.getClientRects().length) event.preventDefault()
        }, { signal: abort })
        input.addEventListener("input", () => { unsent = input.value; resize_input(); if (key) drafts.set(key.room, input.value) })
        input.addEventListener("keydown", event => { if (event.key === "Enter" && !event.shiftKey && !event.isComposing && !send.disabled) { event.preventDefault(); composer.requestSubmit() } })
        composer.addEventListener("submit", event => {
            event.preventDefault()
            if (send.disabled || !input.value.trim()) return
            send.disabled = true; input.readOnly = true
            void (async () => {
                try {
                    if (!context || context.error || (!owner && !context.owner_key)) context = await work_context(true)
                    if (abort.aborted) return
                    if (!owner) key = await prepare_conversation(context)
                    storage_status(context)
                    if (!key || !context) throw new Error(label("choose_client"))
                    let message = pending.get(key.room)
                    if (!message) {
                        const id = crypto.randomUUID()
                        message = { id, text: input.value, envelope: await encrypt_message(key.key, input.value, { room: key.room, id, author: owner ? "owner" : "client" }) }
                        pending.set(key.room, message)
                    }
                    if (watched !== key.room) await watch_live(); else await realtime_ready(abort)
                    const result = await realtime_request({ type: "send", channel: "work", conversation: key.room, id: message.id, envelope: message.envelope }, abort)
                    await apply_messages([result.message], false)
                    pending.delete(key.room); drafts.delete(key.room)
                    if (abort.aborted) return
                    input.value = unsent = ""; resize_input(); send_label(); status.textContent = ""
                } catch (error) { context = undefined; if (!abort.aborted) { status.textContent = `${label("not_sent")} ${error_text(error)}`; send_label(true) } }
                finally { if (!abort.aborted) { send.disabled = false; input.readOnly = Boolean(key && pending.has(key.room)); input.focus() } }
            })()
        })
        window.addEventListener("offline", render_presence, { signal: abort })
        try {
            context = await work_context()
            if (abort.aborted || revision !== generation) return
            const next_identity = context.auth.user?.email ?? "guest"
            if (identity && identity !== next_identity) { drafts.clear(); pending.clear(); input.value = unsent = ""; remove_panel() }
            identity = next_identity
            owner = context.auth.user?.role === "owner"
            if (!context.auth.user) acquire_guest(abort)
            render_presence()
            account_menu.append(element("p", context.auth.user?.email ?? label("guest"), "desk_messages_account_name"))
            account_controls(account_menu, context)
            const update_avatar = () => { account_head.replaceChildren(avatar(context?.auth.user?.picture)) }
            update_avatar()
            document.addEventListener("jazu:profile", () => { void get_auth().then(auth => { if (context && !abort.aborted) { context.auth = auth; update_avatar() } }) }, { signal: abort })
            storage_status(context)
            if (context.error && context.auth.user) {
                const reconnect = element("button", label("drive_connect")); reconnect.dataset.sign = "drive"; toolbar.append(reconnect)
            }
            if (owner) {
                clients_panel(context)
                if (context.error) throw new Error(context.error)
                if (requested === context.owner_email) requested = new URL(location.href).searchParams.get("chat") ?? requested
                const room = (await rooms(context)).find(room => room.email === requested)
                if (!room) { composer.hidden = true; empty.textContent = label("choose_client"); status.textContent = ""; return }
                if (!room.owner_wrap || !context.vault?.value?.owner || room.owner_key_id !== context.owner_key?.key_id) throw new Error("The owner's private key does not match this conversation")
                key = { room: room.id, key: await unwrap_room_key(room.owner_wrap, context.vault.value.owner.private_jwk, room.id), owner_wrap: room.owner_wrap, key_id: room.owner_key_id }
                address(room.email)
                if (room.revoked) { input.disabled = true; send.disabled = true; notice.textContent = label("closed") }
            } else { address(context.owner_email); key = context.key }
            if (context.warning) { warning.hidden = false; warning.textContent = context.warning }
            const auth_error = new URL(location.href).searchParams.get("auth_error")
            if (auth_error) { warning.hidden = false; warning.textContent = label("google_failed") + ` (${auth_error})` }
            if (context.error) { status.textContent = context.error; return }
            status.textContent = context.owner_key ? "" : label("owner_not_ready")
            if (key) {
                input.value = drafts.get(key.room) ?? pending.get(key.room)?.text ?? unsent
                if (pending.has(key.room)) { input.readOnly = true; send_label(true) }

            }
            if (key) document.dispatchEvent(new CustomEvent("jazu:conversation-open", { detail: { channel: "work", conversation: key.room } }))
            initialized = true
            void watch_live().catch(error => { if (!abort.aborted) status.textContent = error_text(error) })
            resize_input()
        } catch (error) { if (!abort.aborted) { render_presence(); status.textContent = error_text(error) } }
    }
    document.addEventListener("jazu:auth", () => { void initialize() }, { signal })
    document.addEventListener("jazu:guest-resume", () => { void work_context(true).then(() => initialize()).catch(() => {}) }, { signal })
    void initialize()
    return root
}
