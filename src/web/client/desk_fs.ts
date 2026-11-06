// The Files side of a file-system desk. The server renders a Linux root of empty folders (the markup in desk.xml); this reads that markup into a
// small tree, draws it again with its own state (open folders, the selected item) and opens files in windows.
// /home/user will be backed by the browser's private file system (OPFS) and folders the visitor picks by the File System Access API (see below).

import type { desk_window } from "./desk.ts"
import { state, text, new_window, focus_window, refresh_tab } from "./desk.ts"
import { load_file, load_folder, open_source, head_part, upload_hooks, uri_handlers } from "./desk_view.ts"
import { resolve as resolve_node } from "./desk_vfs.ts"
import { memory_directory, named_directory, type memory_handle } from "./memory_fs.ts"
import { available_name, rename_pattern, zip_blob, type zip_entry } from "./desk_files_util.ts"
import { can_browse, can_read, can_create, can_move, check_permissions } from "./desk_fs_permissions.ts"
import { selection_click, type file_selection } from "./desk_selection.ts"
import { local_file_path } from "./desk_paths.ts"
import { sync_navigation } from "./desk_navigation.ts"

export type fs_node = {
    name: string
    path: string
    kind: "dir" | "file"
    info: string
    parent: fs_node | null
    // folders: null until listed (a folder with a handle is listed when it is opened); the markup's own folders start with their children
    children: fs_node[] | null
    handle: unknown
    // a folder whose contents the visitor may change (OPFS and picked folders); everything the markup describes is read-only
    writable: boolean
    readable?: boolean
    content_readable?: boolean
    write_allowed?: boolean
    owner_uid?: number
    owner_gid?: number
    // a folder from the visitor's computer, listed under /home (its handle is kept in IndexedDB)
    mount?: boolean
}

type tree_state = file_selection & {
    root: fs_node
    page: HTMLElement
    open: Set<string>
    selected: fs_node | null
    tools_visible: boolean
    message: HTMLElement | null
    // a new file or folder that has no name yet: its row sits first in the folder, with the name field active (nothing exists until it is named)
    draft: { dir: fs_node, kind: "file" | "dir", value: string } | null
}

let tree: tree_state | null = null
let shared_root: fs_node | null = null

// Uploads stay in a memory directory until explicitly saved into /home/user.
const temporary_files = memory_directory("tmp")
let home_node: fs_node | null = null
let filesystem_ready: Promise<void> = Promise.resolve()
export function filesystem_initialized(): Promise<void> { return filesystem_ready }

export function replace_directory(node: fs_node, handle: dir_handle, writable: boolean): void {
    node.handle = named_directory(node.name, handle); node.writable = writable; node.children = null
    const parent = node.parent?.handle as memory_handle | null
    parent?.mount?.(node.name, node.handle as dir_handle)
}

async function seed_system(node: fs_node): Promise<void> {
    const handle = memory_directory(node.name)
    node.handle = handle
    for (const child of node.children ?? []) { await seed_system(child); handle.mount(child.name, child.handle as dir_handle) }
    if (node.path === "/etc") {
        const files: Record<string, string> = {
            passwd: "root::0:0:Administrator:/root:/bin/sh\nuser::1000:1000:Browser user:/home/user:/bin/sh\n",
            group: "root:x:0:\nuser:x:1000:\n",
            "os-release": "NAME=Jazu\nPRETTY_NAME=\"Jazu Browser Desktop\"\nID=jazu\nVERSION_ID=0.12\n",
            hostname: "jasouza\n", shells: "/bin/sh\n/bin/ash\n",
        }
        for (const [name, content] of Object.entries(files)) { const file = await handle.getFileHandle(name, { create: true }); const writer = await file.createWritable!(); await writer.write(content); await writer.close() }
        await load_children(node)
    }
}
let tmp_node: fs_node | null = null
let executable_names: string[] = []
let clipboard: fs_node[] = []
let clipboard_mode: "copy" | "cut" = "copy"
export async function mount_executables(names: string[]): Promise<void> {
    await filesystem_initialized()
    executable_names = names
    const bin = find_node("/bin")
    if (!bin) return
    const directory = memory_directory("bin")
    for (const name of names) {
        const file = await directory.getFileHandle(name, { create: true })
        const writer = await file.createWritable!()
        await writer.write(JSON.stringify({ executable: `/bin/${name}`, runtime: "desk" }))
        await writer.close()
    }
    replace_directory(bin, directory, false)
    await load_children(bin)
    redraw()
}

// ---- the tree ---------------------------------------------------------------------------------------------------------------------

function read_markup(box: Element, parent: fs_node | null): fs_node {
    const head = box.querySelector(":scope > details > summary")
    const name = head?.querySelector(".desk_side_item_name")?.textContent ?? ""
    const info = box.querySelector(":scope > details > .desk_side_item_info")?.textContent ?? ""
    const path = parent ? `${parent.path === "/" ? "" : parent.path}/${name}` : "/"
    const node: fs_node = { name: parent ? name : "/", path, kind: "dir", info, parent, children: [], handle: null, writable: false }
    for (const child of box.querySelectorAll(":scope > details > ul > li > .desk_side_item")) node.children!.push(read_markup(child, node))
    return node
}

export function find_node(path: string, from: fs_node | null = tree?.root ?? null): fs_node | null {
    if (!from) return null
    if (from.path === path) return from
    for (const child of from.children ?? []) {
        const found = find_node(path, child)
        if (found) return found
    }
    return null
}

function icon_of(node: fs_node): string {
    if (node.kind === "dir") return state.data?.folder_icon ?? ""
    const extension = node.name.includes(".") ? (node.name.split(".").pop() ?? "").toLowerCase() : ""
    return state.data?.mimes.find(info => info.extensions.includes(extension))?.icon ?? state.data?.file_icon ?? ""
}

// The row of a new item: its icon and a name field. Enter makes the item (when there is a name), Escape or an empty name drops it.
function render_draft(draft: NonNullable<tree_state["draft"]>): HTMLElement {
    const article = document.createElement("article")
    article.className = "desk_side_item desk_side_item_draft"
    article.dataset.kind = draft.kind
    const box = document.createElement("details")
    box.className = "desk_side_item_box"
    const head = document.createElement("summary")
    head.className = "desk_side_item_head"
    const icon = document.createElement("span")
    icon.className = "desk_side_item_icon"
    icon.setAttribute("aria-hidden", "true")
    icon.textContent = draft.kind === "dir" ? (state.data?.folder_icon ?? "") : (state.data?.file_icon ?? "")
    const input = document.createElement("input")
    input.type = "text"
    input.className = "desk_side_item_rename"
    const label = text(draft.kind === "dir" ? "files_new_folder" : "files_new_file")
    input.placeholder = label
    input.setAttribute("aria-label", label)
    input.autocomplete = "off"
    input.spellcheck = false
    input.value = draft.value
    // the field sits inside a <summary>: keys and clicks in it must not open or close the row
    for (const type of ["click", "keydown", "keyup", "pointerdown"]) input.addEventListener(type, event => event.stopPropagation())
    input.addEventListener("input", () => {
        draft.value = input.value
    })
    input.addEventListener("keydown", event => {
        if (event.key === "Enter") {
            event.preventDefault()
            void commit_draft(input.value)
        } else if (event.key === "Escape") {
            event.preventDefault()
            cancel_draft()
        }
    })
    head.append(icon, input)
    box.append(head)
    article.append(box)
    return article
}

function cancel_draft(): void {
    if (!tree?.draft) return
    tree.draft = null
    redraw()
}

async function commit_draft(value: string): Promise<void> {
    const draft = tree?.draft
    if (!tree || !draft) return
    const name = value.trim()
    // no name: nothing is created
    if (name === "") return cancel_draft()
    if (!valid_name(name)) return note(text("files_bad_name"))
    if (exists_in(draft.dir, name)) return note(text("files_exists"))
    tree.draft = null
    await create_entry(draft.dir, name, draft.kind)
}

async function start_create(kind: "file" | "dir"): Promise<void> {
    if (!tree) return
    const dir = create_target()
    if (!can_create(dir)) return note(text("files_unsupported"))
    if (!dir) return
    if (dir.children === null) await load_children(dir)
    tree.open.add(dir.path)
    // the folders above it open too, so the new row is in view
    for (let up = dir.parent; up; up = up.parent) tree.open.add(up.path)
    tree.draft = { dir, kind, value: "" }
    clear_form()
    redraw()
}

// The tools of the selected item sit under its row: rename, copy, download and delete work on that item, so they live with it
// (the bar at the bottom only makes new things: a file, a folder, an upload).
function make_item_tools(node: fs_node): HTMLElement {
    const tools = document.createElement("div")
    tools.className = "desk_side_item_tool"
    tools.setAttribute("role", "toolbar")
    tools.setAttribute("aria-label", `${text("files_toolbar")}: ${node.name}`)
    tools.append(button("rename", text("files_rename"), "rename"))
    tools.append(button("copy", text("files_copy"), "copy"))
    tools.append(button("cut", text("files_cut"), "cut"))
    tools.append(button("download", text("files_download"), "download"))
    tools.append(button("delete", text("files_delete"), "delete"))
    return tools
}

function render_node(node: fs_node, current: tree_state): HTMLElement {
    const article = document.createElement("article")
    article.className = "desk_side_item"
    article.dataset.kind = node.kind
    article.dataset.path = node.path
    const box = document.createElement("details")
    box.className = "desk_side_item_box"
    box.open = node.kind === "dir" ? current.open.has(node.path) : current.selected === node && current.tools_visible
    const head = document.createElement("summary")
    head.className = "desk_side_item_head"
    if (current.selection.has(node.path)) head.setAttribute("data-selected", "")
    if (current.selected === node) head.setAttribute("data-focused", "")
    // Readable entries can be dropped into a viewer; move targets separately enforce write permissions.
    head.draggable = node.kind === "dir" ? can_browse(node) : can_read(node)
    const icon = document.createElement("span")
    icon.className = "desk_side_item_icon"
    icon.setAttribute("aria-hidden", "true")
    icon.textContent = icon_of(node)
    const name = document.createElement("h3")
    name.className = "desk_side_item_name"
    name.textContent = node.name
    head.append(icon, name)
    box.append(head)
    if (node.info) {
        const info = document.createElement("p")
        info.className = "desk_side_item_info"
        info.textContent = node.info
        box.append(info)
    }
    if (current.selected === node && current.tools_visible && node.parent) box.append(make_item_tools(node))
    if (node.kind === "dir") {
        const list = document.createElement("ul")
        list.className = "desk_side_item_sub"
        // a folder not listed yet gets one hidden row, so its caret shows and opening it can list it
        if (node.children === null) {
            const wait = document.createElement("li")
            wait.hidden = true
            list.append(wait)
        } else {
            if (current.draft?.dir === node) {
                const row = document.createElement("li")
                row.append(render_draft(current.draft))
                list.append(row)
            }
            for (const child of node.children) {
                const row = document.createElement("li")
                row.append(render_node(child, current))
                list.append(row)
            }
        }
        box.append(list)
    }
    article.append(box)
    return article
}

export function fs_root(): fs_node | null {
    return shared_root
}

// a folder was changed from outside the tree (a process): list it again and redraw, without opening it
export async function refresh_dir(dir: fs_node): Promise<void> {
    await load_children(dir)
    redraw()
    document.dispatchEvent(new CustomEvent("jazu:fs:changed", { detail: { path: dir.path } }))
}

export function redraw(): void {
    if (!tree) return
    if (tree.selected) tree.selected = find_node(tree.selected.path)
    tree.selection = new Set([...tree.selection].filter(path => find_node(path)))
    if (tree.anchor && !find_node(tree.anchor)) { tree.anchor = tree.selected?.path ?? null; tree.range_base = null }
    const holder = tree.page
    holder.replaceChildren(render_node(tree.root, tree))
    sync_buttons()
    // a row that waits for its name keeps the focus (and what was typed) through a redraw
    if (tree.draft) {
        const field = holder.querySelector<HTMLInputElement>(".desk_side_item_rename")
        field?.focus()
        field?.setSelectionRange(field.value.length, field.value.length)
    }
}

function note(message: string): void {
    if (tree?.message) tree.message.textContent = message
}

// ---- handles ------------------------------------------------------------------------------------------------------------------
// OPFS and a picked folder are both FileSystemDirectoryHandles. The DOM types in this project's TypeScript lib predate parts of the API, so the
// bits used here are described locally.

type writable_stream = { write(data: Blob | string): Promise<void>, close(): Promise<void> }
export type file_handle = { kind: "file", name: string, getFile(): Promise<File>, createWritable?: () => Promise<writable_stream>, move?: (name: string) => Promise<void> }
export type dir_handle = {
    kind: "directory"
    name: string
    values(): AsyncIterable<file_handle | dir_handle>
    getFileHandle(name: string, options?: { create?: boolean }): Promise<file_handle>
    getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<dir_handle>
    removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>
    move?: (name: string) => Promise<void>
    queryPermission?: (options: { mode: string }) => Promise<string>
    requestPermission?: (options: { mode: string }) => Promise<string>
    native_handle?: dir_handle
}

function child_of(parent: fs_node, handle: file_handle | dir_handle): fs_node {
    return {
        name: handle.name, path: `${parent.path === "/" ? "" : parent.path}/${handle.name}`, kind: handle.kind === "directory" ? "dir" : "file", info: "", parent,
        children: handle.kind === "directory" ? null : [], handle, writable: parent.writable,
        owner_uid: parent.owner_uid, owner_gid: parent.owner_gid,
    }
}

export async function load_children(node: fs_node): Promise<void> {
    const handle = node.handle as dir_handle | null
    if (!handle) return
    const list: fs_node[] = []
    const previous = new Map((node.children ?? []).map(child => [child.name, child]))
    if (node.mount && !(await allowed(handle, "read"))) {
        node.readable = false
        note(text("files_denied"))
        node.children = []
        return
    }
    try {
        for await (const entry of handle.values()) if (!(node === home_node && entry.name === ".jazu_tmp")) {
            const old = previous.get(entry.name)
            if (old && (old.kind === "dir") === (entry.kind === "directory")) { old.handle = entry; list.push(old) }
            else list.push(child_of(node, entry))
        }
        node.readable = true
        node.content_readable = true
    } catch {
        node.readable = false
        node.content_readable = false
        note(text("files_failed"))
    }
    await check_permissions([node])
    list.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1))
    node.children = list
}

async function write_blob(handle: file_handle, blob: Blob): Promise<void> {
    if (!handle.createWritable) throw new Error(text("files_no_save"))
    const stream = await handle.createWritable()
    await stream.write(blob)
    await stream.close()
}

async function save_file(item: desk_window, handle: file_handle, blob: Blob): Promise<void> {
    await write_blob(handle, blob)
    const node = await resolve_node(item.path.replace(/^file:\/\//, ""))
    if (node?.parent) await refresh_dir(node.parent)
}

// ---- opening files ----------------------------------------------------------------------------------------------------------------

async function open_file(node: fs_node, force_new = false): Promise<void> {
    const handle = node.handle as file_handle | null
    if (!handle) return
    // an empty window takes the file; otherwise it gets a window of its own
    const focused = state.focused
    let target: desk_window | null = !force_new && focused && !focused.file && !focused.path && focused.pid === null ? focused : null
    target ??= new_window()
    if (!target) return
    try {
        const file = await handle.getFile()
        await load_file(target, file, node.name, `file://${node.path}`)
        // an edit made in the window goes back into the file
        if (node.writable) target.save = blob => save_file(target, handle, blob)
        focus_window(target)
    } catch {
        note(text("files_open_failed"))
    }
}

export async function open_entry(node: fs_node, force_new = false): Promise<void> {
    if (node.kind === "file") return open_file(node, force_new)
    const focused = state.focused
    const target = !force_new && focused && !focused.file && !focused.path && focused.pid === null ? focused : new_window()
    if (!target) return
    await open_source(target, `file://${node.path}`)
    focus_window(target)
}

// ---- events -----------------------------------------------------------------------------------------------------------------------

let first_click: { path: string, x: number, y: number } | null = null

function node_of(element: Element): fs_node | null {
    const article = element.closest<HTMLElement>(".desk_side_item")
    return article?.dataset.path ? find_node(article.dataset.path) : null
}

function select(node: fs_node | null, selection: Set<string>, tools_visible = true): void {
    if (!tree) return
    tree.selected = node
    tree.tools_visible = tools_visible
    tree.selection = selection
    for (const head of tree.page.querySelectorAll<HTMLElement>(".desk_side_item_head")) {
        head.toggleAttribute("data-selected", tree.selection.has(node_of(head)?.path ?? ""))
        head.removeAttribute("data-focused")
    }
    for (const tools of tree.page.querySelectorAll(".desk_side_item_tool")) tools.remove()
    for (const box of tree.page.querySelectorAll<HTMLDetailsElement>('[data-kind="file"] > details')) box.open = false
    if (!node) { sync_buttons(); return }
    const article = [...tree.page.querySelectorAll<HTMLElement>(".desk_side_item")].find(item => item.dataset.path === node.path)
    article?.querySelector(":scope > details > summary")?.setAttribute("data-focused", "")
    const box = article?.querySelector<HTMLDetailsElement>(":scope > details")
    if (box && node.parent && tools_visible) {
        const tools = make_item_tools(node)
        box.insertBefore(tools, box.querySelector(":scope > ul"))
        if (node.kind === "file") box.open = true
    }
    sync_buttons()
    void refresh_permissions()
}

function activate(node: fs_node): void {
    if (!tree) return
    if (node.kind === "file") void open_file(node)
    else {
        const article = [...tree.page.querySelectorAll<HTMLElement>(".desk_side_item")].find(item => item.dataset.path === node.path)
        const box = article?.querySelector<HTMLDetailsElement>(":scope > details")
        if (box) box.open = !box.open
    }
}

function on_click(event: MouseEvent): void {
    if (!tree) return
    // Moving the toolbar off a parent can move the clicked child upward. Use the
    // native second-click count and original position even if it now hits a tool.
    const previous = first_click
    first_click = null
    const modified = event.ctrlKey || event.metaKey || event.shiftKey
    if (!modified && event.detail === 2 && previous && Math.abs(previous.x - event.clientX) <= 4 && Math.abs(previous.y - event.clientY) <= 4) {
        const node = find_node(previous.path)
        if (node) {
            event.preventDefault()
            void open_entry(node)
            return
        }
    }
    const tool = (event.target as Element).closest<HTMLButtonElement>(".desk_side_item_tool button[data-act]")
    if (tool && tree.page.contains(tool)) {
        const owner = node_of(tool)
        if (owner) run_action(tool.dataset.act ?? "", owner)
        return
    }
    const head = (event.target as Element).closest(".desk_side_item_head")
    if (!head || !tree.page.contains(head)) return
    const node = node_of(head)
    if (!node) return
    if (!modified && node.kind === "dir" && event.detail > 1) { event.preventDefault(); return }
    const rect = head.getBoundingClientRect()
    const box = head.parentElement as HTMLDetailsElement
    const was_open = box.open
    const chevron = node.kind === "dir" && event.clientX >= rect.right - 24 && event.detail !== 0
    if (!modified && !chevron && event.detail === 1) first_click = { path: node.path, x: event.clientX, y: event.clientY }
    event.preventDefault()
    if (tree.draft) {
        tree.draft = null
        redraw()
    }
    const visible = [...tree.page.querySelectorAll<HTMLElement>(".desk_side_item_head")]
        .filter(head => head.getClientRects().length > 0)
        .map(head => node_of(head)?.path).filter((path): path is string => !!path)
    const next = selection_click(tree, visible, node.path, event.ctrlKey || event.metaKey, event.shiftKey)
    tree.anchor = next.anchor
    tree.range_base = next.range_base
    const focused = next.selection.has(node.path) ? node : find_node([...next.selection].at(-1) ?? "")
    select(focused, next.selection, !(chevron && was_open && !modified))
    note(node.path === "/home" ? text("files_open_folder") : "")
    if (!modified && node.kind === "dir" && event.detail < 2 && (!was_open || chevron || event.detail === 0)) activate(node)
    else if (!modified && node.kind === "file" && event.detail === 0) activate(node)
}

function on_double_click(event: MouseEvent): void {
    // Activation is handled by the second click so toolbar layout shifts cannot
    // redirect it; suppress the browser's text selection for this double click.
    event.preventDefault()
}

// the browser opens and closes a folder; this keeps the set of open ones, so a redraw does not close them
function on_toggle(event: Event): void {
    if (!tree) return
    const box = event.target as HTMLDetailsElement
    if (!box.matches(".desk_side_item_box")) return
    const node = node_of(box)
    if (!node || node.kind !== "dir") return
    if (box.open) tree.open.add(node.path)
    else tree.open.delete(node.path)
    if (box.open && node.children === null) void load_children(node).then(redraw)
}

// ---- the tool bar -----------------------------------------------------------------------------------------------------------------

function icon_for(name: string): string {
    return state.data?.icons?.[name] ?? ""
}

function button(action: string, label: string, icon_name: string = ""): HTMLButtonElement {
    const control = document.createElement("button")
    control.type = "button"
    control.dataset.act = action
    const glyph = icon_for(icon_name)
    if (glyph) {
        const mark = document.createElement("span")
        mark.className = "desk_files_icon"
        mark.setAttribute("aria-hidden", "true")
        mark.textContent = glyph
        control.append(mark)
    }
    control.append(label)
    return control
}

function make_bar(): HTMLElement {
    const bar = document.createElement("div")
    bar.className = "desk_files_bar"
    bar.setAttribute("role", "toolbar")
    bar.setAttribute("aria-label", text("files_toolbar"))
    const message = document.createElement("p")
    message.className = "desk_files_msg"
    message.setAttribute("role", "status")
    const buttons = document.createElement("div")
    buttons.className = "desk_files_buttons"
    buttons.append(button("new_file", text("files_new_file"), "file_new"), button("new_folder", text("files_new_folder"), "folder_new"), button("paste", text("files_paste"), "paste"), button("upload", text("files_upload"), "upload"))
    bar.append(message, buttons)
    if (tree) tree.message = message
    return bar
}

function action_disabled(action: string, node: fs_node | null): boolean {
    if (["new_file", "new_folder", "upload", "paste"].includes(action)) {
        const dir = create_target()
        if (!can_create(dir)) return true
        return action === "paste" && (!clipboard.length || clipboard.some(source => !can_read(source) || (clipboard_mode === "cut" && !can_move(source)) || (source.kind === "dir" && (source.path === "/" || dir!.path === source.path || dir!.path.startsWith(`${source.path}/`)))))
    }
    if (!node) return true
    const nodes = selected_nodes(node)
    if (action === "rename" || action === "delete") return nodes.some(item => !item.mount && !can_move(item))
    if (action === "cut") return nodes.some(item => !can_move(item) || !can_read(item))
    if (action === "copy" || action === "download") return nodes.some(item => !can_read(item))
    return false
}

function sync_buttons(): void {
    if (!tree) return
    const side = tree.page.closest(".desk_side")
    for (const control of side?.querySelectorAll<HTMLButtonElement>("button[data-act]") ?? []) {
        control.disabled = action_disabled(control.dataset.act ?? "", node_of(control) ?? tree.selected)
    }
}

async function refresh_permissions(): Promise<void> {
    if (!tree) return
    const nodes = tree.selected ? selected_nodes(tree.selected) : []
    const dir = create_target()
    await check_permissions([...nodes, ...clipboard, ...(dir ? [dir] : [])])
    sync_buttons()
}

// ---- folders from the visitor's computer -------------------------------------------------------------------------------------------
// The File System Access API (showDirectoryPicker, Chromium browsers) lets the visitor give this page a folder. It is listed as /home/<name>, and
// its handle is kept in IndexedDB, so it is there next time (the browser asks for permission again when it is first used).

const mount_db = "jazu_desk"
const mount_store = "mounts"

function open_db(): Promise<IDBDatabase> {
    return new Promise((done, fail) => {
        const request = indexedDB.open(mount_db, 1)
        request.onupgradeneeded = () => request.result.createObjectStore(mount_store, { keyPath: "name" })
        request.onsuccess = () => done(request.result)
        request.onerror = () => fail(request.error)
    })
}

async function with_store<value>(mode: IDBTransactionMode, use: (store: IDBObjectStore) => IDBRequest<value>): Promise<value> {
    const db = await open_db()
    return new Promise((done, fail) => {
        const request = use(db.transaction(mount_store, mode).objectStore(mount_store))
        request.onsuccess = () => done(request.result)
        request.onerror = () => fail(request.error)
    })
}

async function allowed(handle: dir_handle, mode = "readwrite"): Promise<boolean> {
    if (!handle.queryPermission) return true
    const options = { mode }
    if ((await handle.queryPermission(options)) === "granted") return true
    return (await handle.requestPermission?.(options)) === "granted"
}

function mount_node(home: fs_node, name: string, handle: dir_handle): fs_node {
    const node: fs_node = { name, path: `${home.path}/${name}`, kind: "dir", info: "", parent: home, children: null, handle, writable: true, mount: true }
    ;(home.handle as memory_handle)?.mount?.(name, handle)
    return node
}

async function restore_mounts(root: fs_node): Promise<void> {
    const home = find_node("/home", root)
    if (!home) return
    try {
        const saved = await with_store<{ name: string, handle: dir_handle }[]>("readonly", store => store.getAll())
        for (const entry of saved) if (!exists_in(home, entry.name)) home.children!.push(mount_node(home, entry.name, entry.handle))
        if (saved.length > 0) redraw()
    } catch {
        // no IndexedDB (a private window): folders last until the page closes
    }
}

async function add_mount(name: string, handle: dir_handle): Promise<void> {
    const home = find_node("/home")
    if (!home) return
    if (!valid_name(name)) return note(text("files_bad_name"))
    if (exists_in(home, name)) return note(text("files_exists"))
    const node = mount_node(home, name, handle)
    home.children!.push(node)
    try {
        await with_store("readwrite", store => store.put({ name, handle }))
    } catch {
        // kept for this visit only
    }
    clear_form()
    note("")
    if (tree) {
        tree.open.add(home.path)
        tree.selected = node
    }
    redraw()
}

async function pick_folder(): Promise<void> {
    const picker = (window as unknown as { showDirectoryPicker?: (options: { mode: string }) => Promise<dir_handle> }).showDirectoryPicker
    if (!picker) return note(text("files_cannot_edit"))
    let handle: dir_handle
    try {
        handle = await picker.call(window, { mode: "readwrite" })
    } catch {
        // closed without choosing
        return
    }
    show_form(text("files_username"), handle.name, [{ text: text("files_ok"), done: value => add_mount(value, handle) }])
}

async function forget_mount(node: fs_node): Promise<void> {
    const home = node.parent
    if (!home?.children) return
    home.children = home.children.filter(child => child !== node)
    await (home.handle as dir_handle)?.removeEntry(node.name, { recursive: true })
    try {
        await with_store("readwrite", store => store.delete(node.name))
    } catch {
        // nothing kept
    }
    clear_form()
    if (tree) {
        tree.selected = home
        for (const path of [...tree.open]) if (path === node.path || path.startsWith(`${node.path}/`)) tree.open.delete(path)
    }
    redraw()
    note(text("files_forgot"))
}

async function rename_mount(node: fs_node, name: string): Promise<void> {
    const home = node.parent
    if (!home || !valid_name(name)) return note(text("files_bad_name"))
    if (name === node.name) return clear_form()
    if (exists_in(home, name)) return note(text("files_exists"))
    try {
        await with_store("readwrite", store => store.delete(node.name))
        await with_store("readwrite", store => store.put({ name, handle: (node.handle as dir_handle).native_handle ?? node.handle }))
    } catch {
        // kept for this visit only
    }
    const old_path = node.path
    await (home.handle as dir_handle)?.removeEntry(node.name, { recursive: true })
    home.children = home.children!.filter(child => child !== node)
    const next = mount_node(home, name, node.handle as dir_handle)
    home.children.push(next)
    if (tree) {
        tree.open = new Set([...tree.open].map(path => (path === old_path || path.startsWith(`${old_path}/`) ? next.path + path.slice(old_path.length) : path)))
        tree.selected = next
    }
    clear_form()
    note("")
    redraw()
}

// What the buttons do to the selected item. Create and Upload act on the selected folder (or the folder a selected file is in); Rename and Delete
// on the item itself. Only folders with a handle (OPFS, picked folders) can change; the rest of the tree is read-only.

function valid_name(name: string): boolean {
    return name.length > 0 && name !== "." && name !== ".." && !/[\/\u0000]/.test(name)
}

function target_dir(node: fs_node): fs_node | null {
    return node.kind === "dir" ? node : node.parent
}

function clear_form(): void {
    tree?.page.closest(".desk_side")?.querySelector(".desk_files_form")?.remove()
}

// The one small form of the bar: a name (create, rename) or a question (delete), with its buttons.
function show_form(label: string, value: string | null, buttons: { text: string, done: (value: string) => Promise<void> | void }[]): void {
    clear_form()
    const bar = tree?.page.closest(".desk_side")?.querySelector(".desk_files_bar")
    if (!bar) return
    const form = document.createElement("form")
    form.className = "desk_files_form"
    form.setAttribute("aria-label", label)
    let input: HTMLInputElement | null = null
    if (value !== null) {
        input = document.createElement("input")
        input.type = "text"
        input.value = value
        input.placeholder = label
        input.setAttribute("aria-label", label)
        input.autocomplete = "off"
        input.spellcheck = false
        form.append(input)
    } else {
        const question = document.createElement("span")
        question.textContent = label
        form.append(question)
    }
    buttons.forEach((entry, index) => {
        const control = document.createElement("button")
        control.type = "button"
        control.textContent = entry.text
        control.addEventListener("click", () => {
            void Promise.resolve(entry.done(input?.value.trim() ?? "")).then(() => undefined)
        })
        form.append(control)
    })
    const cancel = document.createElement("button")
    cancel.type = "button"
    cancel.textContent = text("files_cancel")
    cancel.addEventListener("click", clear_form)
    form.append(cancel)
    form.addEventListener("submit", event => {
        event.preventDefault()
        buttons[0]?.done(input?.value.trim() ?? "")
    })
    form.addEventListener("keydown", event => {
        if (event.key === "Escape") clear_form()
    })
    bar.insertBefore(form, bar.querySelector(".desk_files_buttons"))
    input?.focus()
    input?.select()
}

async function reload(dir: fs_node, select_path: string | null = null): Promise<void> {
    await load_children(dir)
    if (!tree) return
    tree.open.add(dir.path)
    if (select_path) {
        tree.selected = find_node(select_path)
        tree.selection = new Set([select_path])
        tree.anchor = select_path
        tree.range_base = null
        tree.tools_visible = true
    }
    redraw()
    document.dispatchEvent(new CustomEvent("jazu:fs:changed", { detail: { path: dir.path } }))
}

function exists_in(dir: fs_node, name: string): boolean {
    return (dir.children ?? []).some(child => child.name === name)
}

async function create_entry(dir: fs_node, name: string, kind: "file" | "dir"): Promise<void> {
    if (!valid_name(name)) return note(text("files_bad_name"))
    if (dir.children === null) await load_children(dir)
    if (exists_in(dir, name)) return note(text("files_exists"))
    const handle = dir.handle as dir_handle
    try {
        if (kind === "file") await handle.getFileHandle(name, { create: true })
        else await handle.getDirectoryHandle(name, { create: true })
    } catch {
        return note(text("files_failed"))
    }
    clear_form()
    note("")
    await reload(dir, `${dir.path}/${name}`)
    const made = find_node(`${dir.path}/${name}`)
    if (made?.kind === "file") void open_file(made)
}

async function upload_files(dir: fs_node, files: File[]): Promise<void> {
    const handle = dir.handle as dir_handle
    let last = ""
    try {
        for (const file of files) {
            if (!valid_name(file.name)) continue
            await write_blob(await handle.getFileHandle(file.name, { create: true }), file)
            last = file.name
        }
    } catch (error) {
        note(error instanceof Error && error.message ? error.message : text("files_failed"))
        await reload(dir)
        return
    }
    note(`${text("files_done_upload")}: ${files.length}`)
    await reload(dir, last ? `${dir.path}/${last}` : null)
}

function pick_files(dir: fs_node): void {
    const input = document.createElement("input")
    input.type = "file"
    input.multiple = true
    input.addEventListener("change", () => void upload_files(dir, [...(input.files ?? [])]))
    input.click()
}

// Copy for a browser that cannot move a handle: the new name is made first, the old one removed only when the copy is whole.
async function copy_into(from: file_handle | dir_handle, to_parent: dir_handle, name: string): Promise<void> {
    if (from.kind === "file") {
        await write_blob(await to_parent.getFileHandle(name, { create: true }), await from.getFile())
        return
    }
    const made = await to_parent.getDirectoryHandle(name, { create: true })
    for await (const entry of from.values()) await copy_into(entry, made, entry.name)
}

async function rename_entry(node: fs_node, name: string): Promise<void> {
    const parent = node.parent
    if (!parent || !valid_name(name)) throw new Error(text("files_bad_name"))
    if (name === node.name) return clear_form()
    if (parent.children === null) await load_children(parent)
    if (exists_in(parent, name)) throw new Error(text("files_exists"))
    const handle = node.handle as file_handle | dir_handle
    try {
        if (typeof handle.move === "function") await handle.move(name)
        else {
            await copy_into(handle, parent.handle as dir_handle, name)
            await (parent.handle as dir_handle).removeEntry(node.name, { recursive: true })
        }
    } catch {
        throw new Error(text("files_failed"))
    }
    const old_path = node.path
    const new_path = `${parent.path}/${name}`
    clear_form()
    note("")
    // open folders and windows that pointed into the old path follow the new one
    if (tree) tree.open = new Set([...tree.open].map(path => (path === old_path || path.startsWith(`${old_path}/`) ? new_path + path.slice(old_path.length) : path)))
    const affected: desk_window[] = []
    for (const item of state.windows) {
        if (item.path === `file://${old_path}`) {
            item.path = `file://${new_path}`
            item.name = name
        } else if (item.path.startsWith(`file://${old_path}/`)) item.path = `file://${new_path}${item.path.slice(`file://${old_path}`.length)}`
        else continue
        affected.push(item)
    }
    await reload(parent, new_path)
    for (const item of affected) {
        const renamed = await resolve_node(item.path.replace(/^file:\/\//, ""))
        if (renamed?.kind === "file" && renamed.handle) {
            const renamed_handle = renamed.handle as file_handle
            item.file = await renamed_handle.getFile()
            if (renamed.writable) item.save = blob => save_file(item, renamed_handle, blob)
        }
        // Keep the editor and its pending changes intact while updating its destination.
        sync_navigation(item)
        item.el.dataset.path = item.path
        refresh_tab(item)
    }
}

async function delete_entry(node: fs_node): Promise<void> {
    const parent = node.parent
    if (!parent) return
    try {
        await (parent.handle as dir_handle).removeEntry(node.name, { recursive: true })
    } catch {
        throw new Error(text("files_failed"))
    }
    clear_form()
    note("")
    if (tree) {
        tree.selected = parent
        for (const path of [...tree.open]) if (path === node.path || path.startsWith(`${node.path}/`)) tree.open.delete(path)
    }
    await reload(parent)
}

function on_bar_click(event: MouseEvent): void {
    const control = (event.target as Element).closest<HTMLButtonElement>("button[data-act]")
    if (!control || !tree) return
    run_action(control.dataset.act ?? "", tree.selected)
}

function selected_nodes(node: fs_node): fs_node[] {
    if (!tree?.selection.has(node.path)) return [node]
    return [...tree.selection].map(path => find_node(path)).filter((item): item is fs_node => !!item)
}

// A selected parent already includes its selected descendants for recursive actions.
function topmost(nodes: fs_node[]): fs_node[] {
    return nodes.filter(node => !nodes.some(parent => parent !== node && (parent.path === "/" || node.path.startsWith(`${parent.path}/`))))
}

async function rename_entries(nodes: fs_node[], pattern: string): Promise<void> {
    const occupied = new Map<fs_node, Set<string>>()
    const plans: { path: string, name: string }[] = []
    // Validate every expansion before changing any files, including invalid regex filters.
    for (const [index, node] of nodes.entries()) {
        const parent = node.parent!
        if (parent.children === null) await load_children(parent)
        let names = occupied.get(parent)
        if (!names) occupied.set(parent, names = new Set((parent.children ?? []).map(child => child.name)))
        const expanded = rename_pattern(pattern, node.name, index)
        if (!valid_name(expanded)) throw new Error(text("files_bad_name"))
        names.delete(node.name)
        const name = available_name(expanded, names)
        names.add(name)
        plans.push({ path: node.path, name })
    }
    const renamed: { from: string, to: string }[] = []
    const paths: string[] = []
    for (const plan of plans) {
        let path = plan.path
        for (const change of renamed) if (path === change.from || path.startsWith(`${change.from}/`)) path = change.to + path.slice(change.from.length)
        const current = await resolve_node(path)
        if (!current?.parent) throw new Error(text("files_failed"))
        const next_path = `${current.parent.path}/${plan.name}`
        if (current.mount) await rename_mount(current, plan.name)
        else await rename_entry(current, plan.name)
        if (!find_node(next_path)) throw new Error(text("files_failed"))
        renamed.push({ from: path, to: next_path })
        // Previously renamed children follow a subsequently renamed parent.
        for (let i = 0; i < paths.length; i++) if (paths[i].startsWith(`${path}/`)) paths[i] = next_path + paths[i].slice(path.length)
        paths.push(next_path)
    }
    if (tree) {
        tree.selection = new Set(paths)
        tree.selected = find_node(paths.at(-1) ?? "")
        tree.anchor = tree.selected?.path ?? null
        tree.range_base = null
        tree.tools_visible = true
        redraw()
    }
}

async function copy_node(node: fs_node, parent: dir_handle, name: string): Promise<void> {
    if (node.handle) return copy_into(node.handle as file_handle | dir_handle, parent, name)
    if (node.kind !== "dir") throw new Error(text("files_failed"))
    const folder = await parent.getDirectoryHandle(name, { create: true })
    for (const child of node.children ?? []) await copy_node(child, folder, child.name)
}

async function paste_entries(dir: fs_node): Promise<void> {
    if (!can_create(dir) || !clipboard.length) return note(text("files_unsupported"))
    if (clipboard.some(node => node.kind === "dir" && (dir.path === node.path || node.path === "/" || dir.path.startsWith(`${node.path}/`)))) return note(text("files_unsupported"))
    await load_children(dir)
    const occupied = new Set((dir.children ?? []).map(node => node.name))
    const paths: string[] = []
    for (const node of [...clipboard]) {
        if (clipboard_mode === "cut" && node.parent?.path === dir.path) {
            paths.push(node.path)
            clipboard = clipboard.filter(item => item !== node)
            continue
        }
        const name = available_name(node.name, occupied)
        if (clipboard_mode === "cut") {
            await move_entry(node, dir, name)
            clipboard = clipboard.filter(item => item !== node)
        } else await copy_node(node, dir.handle as dir_handle, name)
        occupied.add(name)
        paths.push(`${dir.path}/${name}`)
    }
    await reload(dir)
    if (tree) {
        tree.selection = new Set(paths)
        tree.selected = find_node(paths.at(-1) ?? "")
        tree.anchor = tree.selected?.path ?? null
        tree.range_base = null
        tree.tools_visible = true
        redraw()
    }
}

function save_download(blob: Blob, name: string): void {
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = name
    document.body.append(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10000)
}

async function archive_node(node: fs_node, path: string, entries: zip_entry[]): Promise<void> {
    if (node.kind === "file") {
        if (!node.handle) throw new Error(text("files_failed"))
        entries.push({ name: path, data: new Uint8Array(await (await (node.handle as file_handle).getFile()).arrayBuffer()) })
        return
    }
    entries.push({ name: `${path}/`, data: new Uint8Array() })
    // Enumerate handles directly: a closed folder need not have been loaded in the tree.
    if (node.handle) {
        for await (const handle of (node.handle as dir_handle).values()) await archive_node(child_of(node, handle), `${path}/${handle.name}`, entries)
    } else for (const child of node.children ?? []) await archive_node(child, `${path}/${child.name}`, entries)
}

async function download_entries(nodes: fs_node[]): Promise<void> {
    const roots = topmost(nodes)
    if (nodes.length === 1 && roots[0].kind === "file") {
        save_download(await (roots[0].handle as file_handle).getFile(), roots[0].name)
        return
    }
    const entries: zip_entry[] = [], names = new Set<string>()
    for (const node of roots) {
        const name = available_name(node.name === "/" ? "root" : node.name, names)
        names.add(name)
        await archive_node(node, name, entries)
    }
    save_download(zip_blob(entries), nodes.length === 1 ? `${nodes[0].name === "/" ? "root" : nodes[0].name}.zip` : "files.zip")
}

export type folder_action = "new_file" | "new_folder" | "paste" | "upload" | "rename" | "copy" | "cut" | "download" | "delete"
export function folder_action_enabled(action: folder_action, dir: fs_node, nodes: fs_node[] = []): boolean {
    if (["new_file", "new_folder", "upload", "paste"].includes(action)) {
        if (!can_create(dir)) return false
        if (action !== "paste") return true
        return clipboard.length > 0 && clipboard.every(source => can_read(source) && (clipboard_mode !== "cut" || can_move(source)) && !(source.kind === "dir" && (source.path === "/" || dir.path === source.path || dir.path.startsWith(`${source.path}/`))))
    }
    if (!nodes.length) return false
    if (action === "rename" || action === "delete") return nodes.every(node => node.mount || can_move(node))
    if (action === "cut") return nodes.every(node => can_move(node) && can_read(node))
    return nodes.every(can_read)
}

export async function perform_folder_action(action: folder_action, dir: fs_node, nodes: fs_node[] = [], value = ""): Promise<void> {
    await check_permissions([dir, ...nodes, ...clipboard])
    if (!folder_action_enabled(action, dir, nodes)) throw new Error(text("files_unsupported"))
    if (action === "new_file" || action === "new_folder") {
        if (!valid_name(value)) throw new Error(text("files_bad_name"))
        await load_children(dir)
        if (exists_in(dir, value)) throw new Error(text("files_exists"))
        await create_entry(dir, value, action === "new_file" ? "file" : "dir")
        if (!find_node(`${dir.path}/${value}`)) throw new Error(text("files_failed"))
    } else if (action === "rename") await rename_entries(nodes, value)
    else if (action === "paste") await paste_entries(dir)
    else if (action === "download") await download_entries(nodes)
    else if (action === "delete") {
        for (const node of topmost(nodes)) {
            if (node.mount) await forget_mount(node)
            else await delete_entry(node)
        }
    } else if (action === "copy" || action === "cut") {
        clipboard = topmost(nodes); clipboard_mode = action
        sync_buttons()
    }
}

export const desk_drag_type = "application/x-jazu-files"
export function start_entry_drag(nodes: fs_node[], transfer: DataTransfer): void {
    dragged = topmost(nodes)
    transfer.setData(desk_drag_type, JSON.stringify(dragged.map(node => node.path)))
    transfer.setData("text/plain", dragged.map(node => node.path).join("\n"))
    transfer.effectAllowed = "copyMove"
}

export function dragged_entries(): fs_node[] { return dragged }
export function end_entry_drag(): void { dragged = [] }

export function can_drop_entries(dir: fs_node, nodes: fs_node[]): boolean {
    return can_create(dir) && nodes.length > 0 && nodes.every(node => can_move(node) && can_read(node) && node.path !== dir.path && !dir.path.startsWith(`${node.path}/`)) && nodes.some(node => node.parent?.path !== dir.path)
}

export async function move_folder_entries(dir: fs_node, paths: string[]): Promise<void> {
    const nodes: fs_node[] = []
    for (const path of paths) {
        const node = await resolve_node(path)
        if (!node) throw new Error(text("files_failed"))
        if (!nodes.some(existing => existing.path === node.path)) nodes.push(node)
    }
    const roots = topmost(nodes)
    await check_permissions([dir, ...roots])
    if (!can_drop_entries(dir, roots)) throw new Error(text("files_unsupported"))
    await load_children(dir)
    const occupied = new Set((dir.children ?? []).map(node => node.name))
    for (const node of roots) {
        if (node.parent?.path === dir.path) continue
        const name = available_name(node.name, occupied)
        await move_entry(node, dir, name)
        occupied.add(name)
    }
}

// The folder a new item goes into: the selected folder, the folder of the selected file, or /home/user when nothing is selected.
function create_target(): fs_node | null {
    const picked = tree?.selected ? target_dir(tree.selected) : null
    return picked ?? find_node("/home/user")
}

function run_action(action: string, node: fs_node | null): void {
    if (!tree) return
    if (action_disabled(action, node)) return
    note("")
    if (tree.draft && action !== "new_file" && action !== "new_folder") tree.draft = null
    if (action === "new_file" || action === "new_folder") {
        void start_create(action === "new_file" ? "file" : "dir")
        return
    }
    if (action === "upload") {
        const store = create_target()
        if (!store || !can_create(store)) return note(text("files_unsupported"))
        clear_form()
        pick_files(store)
        return
    }
    if (!node) return note(text("files_no_selection"))
    const nodes = selected_nodes(node)
    const attempt = async (work: () => Promise<void>): Promise<void> => {
        try { await work() }
        catch (error) { note(error instanceof Error ? error.message : text("files_failed")) }
        finally { await refresh_permissions() }
    }
    if (action === "rename") {
        if (nodes.some(item => !item.mount && !item.parent?.writable)) return note(text("files_unsupported"))
        show_form(text("files_name"), nodes.length === 1 ? node.name : "", [{ text: text("files_ok"), done: value => attempt(() => rename_entries(nodes, value)) }])
    } else if (action === "delete") {
        const roots = topmost(nodes)
        if (roots.some(item => !item.mount && !item.parent?.writable)) return note(text("files_unsupported"))
        show_form(`${text("files_confirm_delete")} ${roots.map(item => item.name).join(", ")}`, null, [{ text: text("files_delete"), done: () => attempt(async () => {
            for (const item of roots) {
                if (item.mount) await forget_mount(item)
                else await delete_entry(item)
            }
            if (tree) {
                tree.selection.clear()
                tree.tools_visible = false
                redraw()
            }
        }) }])
    } else if (action === "copy" || action === "cut") {
        clipboard = topmost(nodes)
        clipboard_mode = action
        sync_buttons()
        note(`${text(action === "cut" ? "files_cut_ready" : "files_copied")}: ${nodes.length}`)
    } else if (action === "paste") {
        const dir = create_target()
        if (dir) void attempt(() => paste_entries(dir))
    }
    else if (action === "download") void attempt(() => download_entries(nodes))
}

// ---- moving by drag and drop ----------------------------------------------------------------------------------------------------
// Only what lives in a writable folder (/home/user, /tmp, a picked folder) moves, and only into another writable folder: the system folders
// described by the markup are neither sources nor targets.

let dragged: fs_node[] = []

async function move_entry(node: fs_node, dir: fs_node, name = node.name): Promise<void> {
    const from = node.parent
    if (!from) return
    if (dir.children === null) await load_children(dir)
    if (exists_in(dir, name)) throw new Error(text("files_exists"))
    const handle = node.handle as file_handle | dir_handle
    const to = dir.handle as dir_handle
    try {
        // a handle moves inside one file system (OPFS); between a picked folder and OPFS it is copied, and the old one removed once the copy is whole
        let moved = false
        if (typeof handle.move === "function") {
            try {
                await (handle.move as unknown as (parent: dir_handle, name: string) => Promise<void>)(to, name)
                moved = true
            } catch {
                moved = false
            }
        }
        if (!moved) {
            await copy_into(handle, to, name)
            await (from.handle as dir_handle).removeEntry(node.name, { recursive: true })
        }
    } catch {
        throw new Error(text("files_failed"))
    }
    const old_path = node.path
    const new_path = `${dir.path}/${name}`
    note("")
    if (tree) tree.open = new Set([...tree.open].map(path => (path === old_path || path.startsWith(`${old_path}/`) ? new_path + path.slice(old_path.length) : path)))
    const affected: desk_window[] = []
    for (const item of state.windows) {
        if (item.path !== `file://${old_path}` && !item.path.startsWith(`file://${old_path}/`)) continue
        if (item.path === `file://${old_path}`) item.name = name
        item.path = `file://${new_path}${item.path.slice(`file://${old_path}`.length)}`
        affected.push(item)
    }
    await reload(from)
    await reload(dir, new_path)
    for (const item of affected) {
        const moved = await resolve_node(item.path.replace(/^file:\/\//, ""))
        if (moved?.kind === "file" && moved.handle) {
            const moved_handle = moved.handle as file_handle
            item.file = await moved_handle.getFile()
            if (moved.writable) item.save = blob => save_file(item, moved_handle, blob)
        }
        sync_navigation(item)
        item.el.dataset.path = item.path
        refresh_tab(item)
    }
}

function drop_head(event: Event): HTMLElement | null {
    return (event.target as Element).closest<HTMLElement>(".desk_side_item_head")
}

function clear_drop_marks(): void {
    for (const mark of tree?.page.querySelectorAll("[data-drop]") ?? []) mark.removeAttribute("data-drop")
}

function bind_drag(page: HTMLElement): void {
    page.addEventListener("dragstart", event => {
        const head = drop_head(event)
        const node = head ? node_of(head) : null
        if (!node || !head?.draggable) return
        if (event.dataTransfer) start_entry_drag(selected_nodes(node), event.dataTransfer)
    })
    page.addEventListener("dragover", event => {
        const head = drop_head(event)
        const onto = head ? node_of(head) : null
        clear_drop_marks()
        if (!event.dataTransfer?.types.includes(desk_drag_type)) return
        if (!head || !onto || !can_drop_entries(target_dir(onto)!, dragged)) return
        event.preventDefault()
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move"
        head.setAttribute("data-drop", "")
    })
    page.addEventListener("dragleave", event => {
        if (!page.contains(event.relatedTarget as Node | null)) clear_drop_marks()
    })
    page.addEventListener("drop", event => {
        const head = drop_head(event)
        const onto = head ? node_of(head) : null
        const nodes = dragged
        dragged = []
        clear_drop_marks()
        if (!event.dataTransfer?.types.includes(desk_drag_type)) return
        const dir = onto ? target_dir(onto) : null
        if (!dir || !can_drop_entries(dir, nodes)) return
        event.preventDefault()
        void move_folder_entries(dir, nodes.map(node => node.path)).catch(() => note(text("files_failed")))
    })
    page.addEventListener("dragend", () => {
        dragged = []
        clear_drop_marks()
    })
}

// /home/user is the browser's private file system for this site (OPFS): it is kept between visits, and only this site can see it.
async function mount_opfs(root: fs_node): Promise<void> {
    const home = find_node("/home", root)
    const user = find_node("/home/user", root)
    const tmp = find_node("/tmp", root)
    const storage = navigator.storage as { getDirectory?: () => Promise<dir_handle> } | undefined
    home_node = user
    tmp_node = tmp
    if (tmp) replace_directory(tmp, temporary_files, true)
    if (!home || !user) return
    if (!storage?.getDirectory) {
        user.writable = false; user.readable = false; user.children = []
        redraw()
        return
    }
    user.writable = true
    user.children = null
    try {
        const handle = await storage.getDirectory()
        replace_directory(user, handle, true)
        await load_children(user)
        redraw()
    } catch {
        user.writable = false
        user.readable = false
        user.children = []
        redraw()
    }
}

// A file brought in from outside the tree (dropped on a window) is written to /tmp; the answer is its path in the tree.
async function store_upload(file: File): Promise<string | null> {
    const dir = tmp_node
    const handle = dir?.handle as dir_handle | null | undefined
    if (!dir || !handle || !valid_name(file.name)) return null
    try {
        await write_blob(await handle.getFileHandle(file.name, { create: true }), file)
    } catch {
        return null
    }
    await reload(dir, `${dir.path}/${file.name}`)
    return `${dir.path}/${file.name}`
}

let uri_bound = false
export function init_fs(desk: HTMLElement): void {
    if (!uri_bound) {
        uri_bound = true
        window.addEventListener("focus", () => void refresh_permissions())
        uri_handlers.push(async (item, uri, current = () => true) => {
            const path = local_file_path(uri)
            if (path === null) return false
            await filesystem_ready
            if (!current()) return true
            const node = await resolve_node(path)
            if (!current()) return true
            if (node?.kind === "dir") {
                load_folder(item, `file://${node.path}`, node.name)
                return true
            }
            if (!node || node.kind !== "file" || !node.handle) return false
            const handle = node.handle as file_handle
            const file = await handle.getFile()
            if (!current()) return true
            await load_file(item, file, node.name, `file://${node.path}`, current)
            if (current() && node.writable) item.save = blob => save_file(item, handle, blob)
            return true
        })
    }
    const page = desk.querySelector<HTMLElement>('.desk_side_page[data-path="file:///"]')
    const root_box = page?.querySelector(":scope > .desk_side_item")
    if (!page || !root_box) {
        tree = null
        return
    }
    const root = shared_root ?? read_markup(root_box, null)
    shared_root = root
    const initial = find_node("/home/user", root)
    tree = { root, page, open: new Set(["/", "/home", "/home/user"]), selected: initial, selection: new Set(initial ? [initial.path] : []), anchor: initial?.path ?? null, range_base: null, tools_visible: true, message: null, draft: null }
    upload_hooks.store = store_upload
    filesystem_ready = (root.handle ? Promise.resolve() : seed_system(root)).then(() => mount_opfs(root))
    void mount_executables(executable_names)
    redraw()
    void filesystem_ready.then(() => restore_mounts(root))
    document.dispatchEvent(new Event("jazu:fs:init"))
    // the bar sits under the tree, in the panel itself, so it stays in view while the tree scrolls
    const side = page.closest(".desk_side")
    const bar = make_bar()
    bar.addEventListener("click", on_bar_click)
    side?.append(bar)
    sync_buttons()
    void refresh_permissions()
    if (!page.dataset.bound) {
        page.dataset.bound = "1"
        page.addEventListener("click", on_click)
        page.addEventListener("dblclick", on_double_click)
        page.addEventListener("toggle", on_toggle, true)
        bind_drag(page)
    }
}
