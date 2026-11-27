import { saved_computes, save_compute, forget_compute, computer_directory, delete_computer_files, type Saved_Compute } from "./computes/store.ts"
import { get_auth } from "../work/sign.ts"
import { set_account_home } from "../fs/account.ts"
import { kernel, kill } from "../kernel/process.ts"
import { drive_directory } from "../fs/drive.ts"
import { google_sign_in } from "../work/sign.ts"
/** Computers share a peer filesystem network; selection only changes the Files view. */
import { state, text } from "../index.ts"
import { filesystem_initialized, fs_root, select_filesystem, filesystem_node, load_children, redraw, dragged_entries, perform_folder_action, type fs_node, type dir_handle } from "../fs/opfs.ts"
import { memory_directory, type memory_handle } from "../fs/memory.ts"
import { option_button, option_group, mount_options } from "./options.ts"

type Compute = { id: string, name: string, kind: "wasm" | "filesystem" | "server", root: fs_node, removable: boolean, saved?: Saved_Compute, connect?: () => Promise<dir_handle> }
const computes = new Map<string, Compute>()
let restored: Promise<void> | null = null
let selected = "vfs", picked = "vfs", changed = () => {}, serial: Promise<void> = Promise.resolve()
async function restore_computes(): Promise<void> {
    for (const saved of await saved_computes()) {
        if (computes.has(saved.id)) continue
        if (saved.kind === "wasm") {
            const handle = await computer_directory(saved.id, saved.name)
            const bin = computes.get("vfs")?.root.children?.find(node => node.name === "bin")?.handle as dir_handle | undefined
            if (bin) handle.mount("bin", bin)
            computes.set(saved.id, { id: saved.id, name: saved.name, kind: "wasm", root: filesystem_node(handle), removable: true, saved })
        } else {
            const compute: Compute = { id: saved.id, name: saved.name, kind: "filesystem", root: filesystem_node(saved.handle || memory_directory(saved.name), !!saved.handle), removable: true, saved }
            if (saved.kind === "drive") compute.connect = async () => {
                if ((await get_auth()).user?.email !== saved.email) throw new Error(`Sign in as ${saved.email} to reconnect this Drive folder`)
                return drive_directory(saved.folder!)
            }
            computes.set(saved.id, compute)
        }
    }
    network()
}
export function selected_compute(): string { return selected }
export function register_compute(id: string, name: string, handle: dir_handle, kind: "server" | "filesystem" = "server"): () => void {
    const compute: Compute = { id, name, kind, root: filesystem_node(handle), removable: kind !== "server" }
    computes.set(id, compute); network(); changed()
    return () => {
        computes.delete(id); network()
        if (selected === id) void select_compute("vfs")
        changed()
    }
}
function peer_directory(handle: dir_handle): dir_handle {
    // A peer's network is not re-exported, so recursive copies cannot loop through peers.
    return { kind: "directory", name: handle.name, native_handle: handle.native_handle || handle,
        async *values() { for await (const entry of handle.values()) if (entry.name !== "net") yield entry },
        getFileHandle: (name, options) => handle.getFileHandle(name, options),
        removeEntry: (name, options) => handle.removeEntry(name, options),
        getDirectoryHandle: (name, options) => { if (name === "net") return Promise.reject(new DOMException("Peer networks are not re-exported", "NotAllowedError")); return handle.getDirectoryHandle(name, options) },
    }
}
function network(): void {
    for (const compute of computes.values()) {
        const handle = compute.root.handle as memory_handle | null
        if (!handle?.mount || compute.kind !== "wasm") continue
        const net = memory_directory("net")
        for (const peer of computes.values()) if (peer !== compute && peer.root.handle) net.mount(peer.id, peer_directory(peer.root.handle as dir_handle))
        handle.mount("net", net)
        const node = compute.root.children?.find(node => node.name === "net")
        if (node) { node.handle = net; node.children = null; node.writable = true }
        else compute.root.children?.push({ name: "net", path: "/net", kind: "dir", info: "Compute network", parent: compute.root, children: null, handle: net, writable: true })
    }
}
export async function select_compute(id: string): Promise<void> {
    const entry = computes.get(id), handle = entry?.root.handle as dir_handle | undefined
    // Permission acquisition begins during the user's click, before queued I/O.
    const permission = entry?.saved?.kind === "folder" && handle?.requestPermission ? handle.requestPermission({ mode: "readwrite" }) : Promise.resolve("granted")
    serial = serial.catch(() => {}).then(async () => {
        const compute = computes.get(id)
        if (!compute) return
        if (await permission !== "granted") throw new Error("Folder permission is required to reconnect this filesystem")
        if (compute.connect) { compute.root = filesystem_node(await compute.connect()); compute.connect = undefined; network() }
        await select_filesystem(compute.root, id === "vfs")
        selected = picked = id; try { sessionStorage.setItem("jazu:compute", id) } catch {}
        state.desk?.setAttribute("data-compute", id); changed()
    })
    return serial
}
export function init_computes_menu(desk: HTMLElement): () => void {
    const side = desk.querySelector<HTMLElement>(".desk_side"), tabs = side?.querySelector(".desk_side_tabs_ul")
    if (!side || !tabs) return () => {}
    const abort = new AbortController(), signal = abort.signal
    const tab = document.createElement("li"), toggle = document.createElement("details"), summary = document.createElement("summary")
    toggle.className = "desk_side_tabs_drop"; toggle.name = "desk_side_tab"; toggle.dataset.path = "desk:computes"
    const icon = document.createElement("span"); icon.className = "desk_menu_tab_icon"; icon.textContent = state.data?.icons?.compute || state.data?.icons?.window || ""
    icon.setAttribute("aria-hidden", "true"); summary.append(icon, "Computes"); toggle.append(summary); tab.append(toggle); tabs.append(tab)
    const panel = document.createElement("div"); panel.className = "desk_side_page desk_computes_menu"; panel.dataset.path = "desk:computes"; panel.hidden = true; panel.setAttribute("role", "feed"); side.append(panel)
    const bar = document.createElement("div"), row = document.createElement("div"), notice = document.createElement("p")
    row.className = "desk_files_buttons"; notice.setAttribute("role", "status")
    const report = (error: unknown) => { notice.textContent = error instanceof Error ? error.message : String(error) }
    const create = option_button("Compute", "compute", () => {
        const name = prompt("Computer name", "Computer")?.trim()
        if (!name) return
        void (async () => {
            await restored
            const id = crypto.randomUUID(), handle = await computer_directory(id, name, true)
            const bin = computes.get("vfs")?.root.children?.find(node => node.name === "bin")?.handle as dir_handle | undefined
            if (bin) handle.mount("bin", bin)
            const saved: Saved_Compute = { id, name, kind: "wasm", order: computes.size }
            await save_compute(saved)
            computes.set(id, { id, name, kind: "wasm", root: filesystem_node(handle), removable: true, saved })
            network(); await select_compute(id)
        })().catch(report)
    })
    const dialog = document.createElement("dialog"), form = document.createElement("form"), source = document.createElement("select"), folder = document.createElement("input"), connect = document.createElement("button"), cancel = document.createElement("button"), dialog_status = document.createElement("p")
    source.setAttribute("aria-label", "Filesystem source"); source.append(new Option("Shared folder", "folder"), new Option("Google Drive", "drive"))
    folder.placeholder = "Google Drive folder URL or ID"; folder.setAttribute("aria-label", folder.placeholder); folder.hidden = true
    source.addEventListener("change", () => { folder.hidden = source.value !== "drive" })
    connect.type = "submit"; connect.textContent = "Connect"; cancel.type = "button"; cancel.textContent = "Cancel"; cancel.addEventListener("click", () => dialog.close())
    dialog_status.setAttribute("role", "status"); form.append(source, folder, connect, cancel, dialog_status); dialog.append(form); desk.append(dialog)
    dialog.setAttribute("aria-label", "Connect filesystem")
    let drive_consent = false
    form.addEventListener("submit", event => {
        event.preventDefault(); dialog_status.textContent = ""
        const mount = async (handle: dir_handle, drive_folder?: string) => {
            if (signal.aborted) return
            await restored
            const id = crypto.randomUUID(), name = handle.name || "Filesystem"
            const saved: Saved_Compute = { id, name, kind: drive_folder ? "drive" : "folder", order: computes.size,
                ...(drive_folder ? { folder: drive_folder, email: (await get_auth()).user!.email } : { handle: handle.native_handle || handle }) }
            await save_compute(saved)
            register_compute(id, name, handle, "filesystem"); computes.get(id)!.saved = saved
            await select_compute(id); dialog.close()
        }
        if (source.value === "drive") {
            if (drive_consent) { google_sign_in(true, true); drive_consent = false; connect.textContent = "Connect"; return }
            const id = /\/folders\/([a-zA-Z0-9_-]+)/.exec(folder.value)?.[1] || folder.value.trim()
            void drive_directory(id).then(handle => mount(handle, id)).catch(error => {
                if (error.message === "drive_consent_required") { drive_consent = true; connect.textContent = "Allow Drive access"; dialog_status.textContent = "Allow Drive access, then click Connect after signing in." }
                else dialog_status.textContent = error.message
            })
        } else {
            const picker = (window as unknown as { showDirectoryPicker?: (options: { mode: string }) => Promise<dir_handle> }).showDirectoryPicker
            if (!picker) { dialog_status.textContent = "This browser does not support shared folders."; return }
            void picker.call(window, { mode: "readwrite" }).then(handle => mount(handle)).catch(error => { if (error.name !== "AbortError") dialog_status.textContent = error.message })
        }
    })
    const filesystem = option_button("Filesystem", "disk", () => dialog.showModal())
    const personal_home = option_button(text("compute_personal_home"), "home", () => {
        const compute = computes.get(picked)
        if (compute?.saved?.kind !== "drive") return
        void (async () => {
            if ((await get_auth()).user?.email !== compute.saved!.email) throw new Error(`Sign in as ${compute.saved!.email} to use this Drive folder`)
            await set_account_home(compute.saved!.folder!)
            notice.textContent = text("compute_home_connected")
        })().catch(report)
    })
    const browser_home = option_button(text("compute_browser_home"), "home", () => {
        void set_account_home(null).then(() => { notice.textContent = text("compute_home_disconnected") }).catch(report)
    })
    const remove = option_button(text("files_delete"), "delete", () => {
        const compute = computes.get(picked)
        if (!compute?.removable || !confirm(compute.kind === "wasm" ? `Delete ${compute.name} and its saved files?` : `Disconnect ${compute.name} from Computes?`)) return
        void (async () => {
            if (selected === compute.id) await select_compute("vfs")
            if (compute.kind === "wasm") {
                for (const process of kernel.table.values()) if (process.filesystem?.scope === compute.root) kill(process.pid, 129)
                await delete_computer_files(compute.id)
            }
            await forget_compute(compute.id)
            computes.delete(compute.id); picked = selected; network(); draw()
        })().catch(report)
    })
    row.append(option_group("New", create, filesystem), option_group("", remove), option_group(text("compute_home"), personal_home, browser_home)); bar.append(row, notice)
    create.disabled = filesystem.disabled = true
    const release = mount_options(panel, bar)
    const draw = () => {
        if (signal.aborted) return
        remove.disabled = !computes.get(picked)?.removable
        personal_home.disabled = computes.get(picked)?.saved?.kind !== "drive"
        panel.replaceChildren(...[...computes.values()].map(compute => {
            const entry = document.createElement("article"), box = document.createElement("details"), head = document.createElement("summary"), title = document.createElement("h3"), mark = document.createElement("span")
            entry.className = "desk_side_item"; entry.dataset.computeId = compute.id; box.className = "desk_side_item_box"; head.className = "desk_side_item_head"
            head.toggleAttribute("data-selected", picked === compute.id); head.toggleAttribute("data-active", selected === compute.id); title.className = "desk_side_item_name"; title.textContent = compute.name
            mark.className = "desk_side_item_icon"; mark.textContent = state.data?.icons?.[compute.kind === "filesystem" ? "disk" : "compute"] || ""
            head.append(mark, title); box.append(head); entry.append(box)
            head.addEventListener("click", event => { event.preventDefault(); picked = compute.id; draw(); void select_compute(compute.id).catch(report) })
            head.draggable = true
            head.addEventListener("dragstart", event => { event.dataTransfer?.setData("application/x-jazu-compute", compute.id) })
            head.addEventListener("dragover", event => { if (dragged_entries().length || event.dataTransfer?.types.includes("application/x-jazu-compute")) event.preventDefault() })
            head.addEventListener("drop", event => {
                const moved = event.dataTransfer?.getData("application/x-jazu-compute")
                if (moved && computes.has(moved)) {
                    event.preventDefault(); if (moved === compute.id) return
                    const ordered = [...computes.values()].filter(item => item.id !== moved)
                    ordered.splice(ordered.findIndex(item => item.id === compute.id), 0, computes.get(moved)!)
                    computes.clear(); ordered.forEach((item, index) => { computes.set(item.id, item); if (item.saved) { item.saved.order = index; void save_compute(item.saved).catch(report) } }); draw(); return
                }
                const sources = dragged_entries(); if (!sources.length) return
                event.preventDefault()
                void (async () => {
                    const root = compute.root; if (root.children === null) await load_children(root)
                    const target = root.children?.find(node => node.name === "tmp") || root
                    // Use handle-based copy through the shared clipboard, across filesystem roots.
                    await perform_folder_action("copy", target, sources)
                    await perform_folder_action("paste", target)
                    notice.textContent = "Copied to " + compute.name
                })().catch(report)
            })
            return entry
        }))
    }
    changed = draw
    void filesystem_initialized().then(() => {
        if (signal.aborted) return
        if (!computes.has("vfs")) { const root = fs_root(); if (root) computes.set("vfs", { id: "vfs", name: "{vfs}", kind: "wasm", root, removable: false }) }
        restored ??= restore_computes().catch(error => { restored = null; throw error })
        return restored.then(async () => {
            if (signal.aborted) return
            let previous = selected; try { previous = sessionStorage.getItem("jazu:compute") || previous } catch {}
            const compute = computes.get(previous)
            const handle = compute?.root.handle as dir_handle | undefined
            const permission = compute?.saved?.kind === "folder" && handle?.queryPermission ? await handle.queryPermission({ mode: "readwrite" }) : "granted"
            // Restoring a page never prompts for folder or Google permissions.
            if (compute && !compute.connect && permission === "granted" && fs_root() !== compute.root) await select_compute(previous)
            desk.dataset.compute = selected
            network(); redraw(); draw(); create.disabled = filesystem.disabled = false
        })
    }).catch(report)
    return () => { abort.abort(); changed = () => {}; release(); dialog.remove(); panel.remove(); tab.remove() }
}
