import { option_button, option_group } from "../menu/options.ts"
/* API releases use the Node supervisor; browser automation scripts remain independent sessions. */
import { get_auth } from "../work/sign.ts"
import { text } from "../index.ts"
type Release = { id: string, version: number, source: string, current: string, previous?: string, online: boolean, transports?: string[] }
export function mount_api_sessions(root: HTMLElement, controls: HTMLElement = root): () => void {
    const abort = new AbortController()
    let disposed = false, busy = false, revision = 0
    let releases: Release[] = [], selected = ""
    root.className = "server_api_sessions"
    const heading = document.createElement("h3"); heading.textContent = text("server_api_title")
    const notice = document.createElement("p"); notice.setAttribute("role", "status"); notice.setAttribute("aria-live", "polite")
    const form = document.createElement("form"), label = document.createElement("label"), source = document.createElement("input")
    source.type = "text"; source.required = true; source.maxLength = 2048; source.name = "source"; source.placeholder = "/home/user/counter.auto.js"
    source.autocomplete = "off"; source.spellcheck = false
    label.append(text("server_api_source"), source)
    const deploy = document.createElement("button"); deploy.type = "submit"; deploy.textContent = text("server_api_deploy")
    const refresh = document.createElement("button"); refresh.type = "button"; refresh.textContent = text("server_api_refresh")
    const list = document.createElement("div"); list.className = "server_api_releases"
    const rollback = option_button(text("server_api_rollback"), "refresh", () => command("rollback"))
    const stop = option_button(text("server_api_stop"), "pause", () => command("stop"))
    rollback.dataset.apiAction = "rollback"; stop.dataset.apiAction = "stop"
    const sync_selection = () => {
        const release = releases.find(item => `${item.id}/v${item.version}` === selected)
        rollback.disabled = busy || !release?.previous; stop.disabled = busy || !release
        for (const entry of list.querySelectorAll<HTMLElement>("[data-api-key]")) entry.toggleAttribute("data-selected", entry.dataset.apiKey === selected)
    }
    const command = (action: string) => {
        const release = releases.find(item => `${item.id}/v${item.version}` === selected)
        if (release) void mutate(action, { id: release.id, version: release.version })
    }
    form.append(label, deploy, refresh); controls.append(heading, form, option_group("API", rollback, stop), notice); root.append(list)
    const set_busy = (value: boolean) => { busy = value; root.setAttribute("aria-busy", String(value)); for (const button of [...root.querySelectorAll<HTMLButtonElement>("button"), ...controls.querySelectorAll<HTMLButtonElement>("button")]) button.disabled = value; sync_selection() }
    const request = async (action = "", body?: unknown) => {
        const auth = body === undefined ? null : await get_auth(true)
        const response = await fetch(`/api/_/apis${action ? `/${action}` : ""}`, { method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store", signal: AbortSignal.any([abort.signal, AbortSignal.timeout(25000)]), headers: { "content-type": "application/json", ...(auth ? { "x-jazu-work": "1", "x-jazu-csrf": auth.csrf } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
        const result = await response.json()
        if (!response.ok || result.error) throw new Error(result.error?.message || text("server_api_error"))
        return result.data
    }
    const draw = (next: Release[]) => {
        releases = next
        if (!releases.some(item => `${item.id}/v${item.version}` === selected)) selected = releases[0] ? `${releases[0].id}/v${releases[0].version}` : ""
        const nodes = releases.map(release => {
            const article = document.createElement("article"); article.className = "desk_side_item server_api_release"; article.dataset.apiKey = `${release.id}/v${release.version}`
            const title = document.createElement("h4"), link = document.createElement("a")
            link.href = `/api/${encodeURIComponent(release.id)}/v${release.version}/`; link.textContent = `${release.id} v${release.version}`; title.append(link)
            const info = document.createElement("p"); info.textContent = `${text(release.online ? "server_script_running" : "server_script_stopped")} · ${release.source}`
            article.append(title, info)
            if (release.transports?.includes("websocket")) { const usage = document.createElement("p"); usage.className = "server_api_usage"; usage.textContent = text("server_api_usage"); article.append(usage) }
            article.addEventListener("click", () => { selected = `${release.id}/v${release.version}`; sync_selection() })
            return article
        })
        list.replaceChildren(...nodes); sync_selection()
    }
    const load = async () => {
        const current = ++revision
        try { const releases = await request() as Release[]; if (!disposed && current === revision) { draw(releases); notice.textContent = "" } }
        catch (error) { if (!disposed && current === revision) notice.textContent = (error as Error).message }
    }
    const mutate = async (action: string, body: unknown) => {
        if (busy || disposed) return
        set_busy(true); revision++; notice.textContent = text("server_api_pending")
        try { await request(action, body); if (!disposed) { await load(); if (!notice.textContent) notice.textContent = text("server_api_done") } }
        catch (error) { if (!disposed) notice.textContent = (error as Error).message }
        finally { if (!disposed) set_busy(false) }
    }
    form.addEventListener("submit", event => { event.preventDefault(); if (form.reportValidity()) void mutate("deploy", { source: source.value.trim() }) })
    refresh.addEventListener("click", () => { if (!busy) void load() })
    void load()
    return () => { disposed = true; revision++; abort.abort(); root.replaceChildren() }
}
