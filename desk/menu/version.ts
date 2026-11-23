/** Public repository Version menus: bounded history, merge groups, refs and immutable commit maps.
 * Requests omit credentials; offline/error states retain the last visible snapshot without inventing history.
 */
import { state, text } from "../index.ts"
import { history_commits, history_refs, history_limit, type History_Commit, type History_Ref } from "../../shared/repo/history.ts"
import { history_graph, history_tree, type Commit_Entry } from "./version/model.ts"

function element<K extends keyof HTMLElementTagNameMap>(tag: K, class_name = "", value = ""): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag)
    node.className = class_name
    node.textContent = value
    return node
}

function entry(item: Commit_Entry, labels: Map<string, string[]>): HTMLElement {
    const commit = item.commit
    const article = element("article", "desk_side_item")
    article.id = `version-commit-${commit.id}`
    article.dataset.kind = "post"
    article.dataset.entryId = commit.id
    const details = element("details", "desk_side_item_box")
    details.open = item.children.length > 0
    const head = element("summary", "desk_side_item_head")
    head.append(element("span", "desk_side_item_icon", state.data?.file_icon ?? ""), element("h3", "desk_side_item_name", commit.subject || commit.id.slice(0, 8)))
    const date = element("time", "desk_side_item_date", new Date(commit.timestamp * 1000).toLocaleDateString(document.documentElement.lang || "en"))
    date.dateTime = new Date(commit.timestamp * 1000).toISOString()
    head.append(element("span", "desk_side_item_code", commit.id.slice(0, 8)), date)
    details.append(head)
    const body = element("div", "desk_side_item_body")
    body.append(element("p", "version_commit_id", commit.id))
    if (labels.has(commit.id)) body.append(element("p", "", labels.get(commit.id)!.join(", ")))
    if (commit.parents.length) body.append(element("p", "", `${text("version_parents")}: ${commit.parents.map(id => id.slice(0, 8)).join(", ")}`))
    details.append(body)
    if (item.children.length) {
        const list = element("ul", "desk_side_item_sub")
        for (const child of item.children) { const li = element("li"); li.append(entry(child, labels)); list.append(li) }
        details.append(list)
    }
    article.append(details)
    return article
}

function map_markup(commits: History_Commit[], refs: History_Ref[], base: string): HTMLElement {
    const map = element("details", "desk_map")
    map.dataset.mapLayout = "graph"; map.dataset.mapReadonly = ""
    map.setAttribute("open", "")
    const summary = element("summary", "", text("desk_map")), nav = element("nav"), list = element("ul")
    const graph = history_graph(commits, refs, base)
    for (const node of graph.nodes) {
        const li = element("li")
        li.dataset.mapNode = node.id; li.dataset.mapX = String(node.x); li.dataset.mapY = String(node.y)
        const label = element("span", "desk_map_label"), link = element("a", "desk_map_name", node.name)
        link.href = `#version-commit-${node.id}`
        label.append(link); li.append(label)
        if (node.info) li.append(element("p", "", node.info))
        list.append(li)
    }
    for (const edge of graph.edges) {
        const li = element("li", "", `${edge.from.slice(0, 8)} → ${edge.to.slice(0, 8)}`)
        li.dataset.mapFrom = edge.from; li.dataset.mapTo = edge.to
        list.append(li)
    }
    nav.append(list); map.append(summary, nav)
    return map
}

async function read_json(url: URL, signal: AbortSignal): Promise<unknown> {
    const response = await fetch(url, { credentials: "omit", cache: "no-store", signal })
    if (!response.ok) throw new Error(`Repository history: ${response.status}`)
    const length = Number(response.headers.get("content-length"))
    if (length > 2 * 1024 * 1024) throw new Error("Repository history is too large")
    if (!response.body) throw new Error("Repository history is empty")
    const reader = response.body.getReader(), decoder = new TextDecoder()
    let total = 0, value = ""
    try {
        while (true) {
            const chunk = await reader.read()
            if (chunk.done) break
            total += chunk.value.byteLength
            if (total > 2 * 1024 * 1024) { await reader.cancel(); throw new Error("Repository history is too large") }
            value += decoder.decode(chunk.value, { stream: true })
        }
        return JSON.parse(value + decoder.decode())
    } finally { reader.releaseLock() }
}

export function init_versions(desk: HTMLElement): () => void {
    const abort = new AbortController(), signal = abort.signal
    const requests = new Set<AbortController>()
    for (const panel of desk.querySelectorAll<HTMLElement>(".desk_side_page[data-version-url]")) {
        const url = new URL(panel.dataset.versionUrl!)
        const list = element("div", "version_entries"), tools = element("nav", "desk_menu_foot version_tools")
        const label = element("label", "", text("version_ref")), select = element("select")
        select.setAttribute("aria-label", text("version_ref"))
        select.append(new Option("HEAD", "HEAD")); label.append(select)
        const refresh = element("button", "", text("folder_refresh")); refresh.type = "button"
        const status = element("p", "version_status"); status.setAttribute("role", "status")
        tools.append(label, refresh)
        panel.append(status, list, tools)
        let refs: History_Ref[] = [], serial = 0, started = false, loaded_ref = ""
        let request: AbortController | null = null
        const load = async (with_refs: boolean) => {
            request?.abort()
            const controller = new AbortController(), ticket = ++serial
            request = controller; requests.add(controller)
            const timer = setTimeout(() => controller.abort(), 12000)
            refresh.disabled = true; status.textContent = text("version_loading")
            try {
                const log = new URL(url), ref_url = new URL(url)
                ref_url.pathname = ref_url.pathname.replace(/\/log$/, "/refs")
                const next_refs = with_refs ? history_refs(await read_json(ref_url, controller.signal)) : refs
                const pinned = next_refs.find(ref => ref.name === select.value)
                log.searchParams.set("ref", pinned ? pinned.commit ?? pinned.hash : select.value)
                const commits = history_commits(await read_json(log, controller.signal))
                if (signal.aborted || ticket !== serial) return
                refs = next_refs
                if (with_refs) {
                    const chosen = select.value
                    select.replaceChildren(new Option("HEAD", "HEAD"))
                    for (const ref of refs) select.append(new Option(ref.name.replace(/^refs\//, ""), ref.name))
                    select.value = [...select.options].some(option => option.value === chosen) ? chosen : "HEAD"
                }
                const labels = new Map<string, string[]>()
                for (const ref of refs) { const id = ref.commit ?? ref.hash; labels.set(id, [...(labels.get(id) ?? []), ref.name.replace(/^refs\//, "")]) }
                list.replaceChildren(...history_tree(commits).map(item => entry(item, labels)))
                panel.querySelector(":scope > .desk_map")?.remove()
                tools.before(map_markup(commits, refs, url.href))
                loaded_ref = select.value
                status.textContent = commits.length ? `${commits.length}/${history_limit} ${text("version_commits")}` : text("version_empty")
            } catch {
                controller.abort()
                if (!signal.aborted && ticket === serial) status.textContent = text("version_unavailable") + (loaded_ref ? ` (${loaded_ref})` : "")
            } finally { clearTimeout(timer); requests.delete(controller); if (ticket === serial) refresh.disabled = false }
        }
        const activate = () => {
            const pages = [...panel.parentElement!.querySelectorAll(":scope > .desk_side_page")]
            const tabs = [...desk.querySelectorAll<HTMLDetailsElement>(".desk_side_tabs_drop")]
            if (!started && tabs[pages.indexOf(panel)]?.open) { started = true; void load(true) }
        }
        select.addEventListener("change", () => { void load(false) }, { signal })
        refresh.addEventListener("click", () => { void load(true) }, { signal })
        desk.addEventListener("toggle", activate, { signal, capture: true })
        desk.addEventListener("click", event => {
            const link = (event.target as Element).closest<HTMLAnchorElement>('a[href^="#version-commit-"]')
            if (!link || !/^#version-commit-(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(link.hash) || !panel.querySelector(`[id="${link.hash.slice(1)}"]`)) return
            event.preventDefault()
            const target = panel.querySelector<HTMLElement>(`[id="${link.hash.slice(1)}"]`)!
            for (let parent: HTMLElement | null = target; parent && parent !== panel; parent = parent.parentElement) if (parent instanceof HTMLDetailsElement) parent.open = true
            const details = target.querySelector<HTMLDetailsElement>(":scope > details")
            if (details) details.open = true
            document.getElementById("head_menu")?.setAttribute("open", "")
            for (const head of panel.querySelectorAll(".desk_side_item_head")) head.removeAttribute("data-focused")
            target.querySelector(".desk_side_item_head")?.setAttribute("data-focused", "")
            requestAnimationFrame(() => { if (target.isConnected) target.scrollIntoView({ block: "nearest", behavior: "instant" }) })
        }, { signal })
        activate()
    }
    return () => { abort.abort(); for (const request of requests) request.abort() }
}
