/* API releases use the Node supervisor; browser automation scripts remain independent sessions. */
import { get_auth } from "../work/sign.ts"
import { text } from "../index.ts"
type Release = { id: string, version: number, source: string, current: string, previous?: string, online: boolean, transports?: string[] }
export function mount_api_sessions(root: HTMLElement): () => void {
    const abort = new AbortController()
    let disposed = false, busy = false, revision = 0
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
    form.append(label, deploy, refresh); root.append(heading, form, notice, list)
    const set_busy = (value: boolean) => { busy = value; root.setAttribute("aria-busy", String(value)); for (const button of root.querySelectorAll<HTMLButtonElement>("button")) button.disabled = value }
    const request = async (action = "", body?: unknown) => {
        const auth = body === undefined ? null : await get_auth(true)
        const response = await fetch(`/api/_/apis${action ? `/${action}` : ""}`, { method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store", signal: AbortSignal.any([abort.signal, AbortSignal.timeout(25000)]), headers: { "content-type": "application/json", ...(auth ? { "x-jazu-work": "1", "x-jazu-csrf": auth.csrf } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
        const result = await response.json()
        if (!response.ok || result.error) throw new Error(result.error?.message || text("server_api_error"))
        return result.data
    }
    const draw = (releases: Release[]) => {
        const nodes = releases.map(release => {
            const article = document.createElement("article"); article.className = "server_api_release"; article.dataset.apiKey = `${release.id}/v${release.version}`
            const title = document.createElement("h4"), link = document.createElement("a")
            link.href = `/api/${encodeURIComponent(release.id)}/v${release.version}/`; link.textContent = `${release.id} v${release.version}`; title.append(link)
            const info = document.createElement("p"); info.textContent = `${text(release.online ? "server_script_running" : "server_script_stopped")} · ${release.source}`
            article.append(title, info)
            if (release.transports?.includes("websocket")) { const usage = document.createElement("p"); usage.className = "server_api_usage"; usage.textContent = text("server_api_usage"); article.append(usage) }
            for (const action of ["rollback", "stop"] as const) {
                if (action === "rollback" && !release.previous) continue
                const button = document.createElement("button"); button.type = "button"; button.dataset.apiAction = action; button.textContent = text(`server_api_${action}`)
                button.addEventListener("click", () => { void mutate(action, { id: release.id, version: release.version }) }); article.append(button)
            }
            return article
        })
        if (!nodes.length) { const empty = document.createElement("p"); empty.textContent = text("server_api_empty"); list.replaceChildren(empty) } else list.replaceChildren(...nodes)
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
