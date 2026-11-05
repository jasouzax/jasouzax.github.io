// The Files side of a file-system desk. The server renders a Linux root of empty folders (the markup in desk.xml); this reads that markup into a
// small tree, draws it again with its own state (open folders, the selected item) and opens files in windows.
// /home/user will be backed by the browser's private file system (OPFS) and folders the visitor picks by the File System Access API (see below).

import type { desk_window } from "./desk.ts"
import { state, text, new_window, focus_window } from "./desk.ts"
import { load_file, render_window as window_refresh, upload_hooks } from "./desk_view.ts"
import { memory_directory } from "./memory_fs.ts"

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
    // a folder from the visitor's computer, listed under /home (its handle is kept in IndexedDB)
    mount?: boolean
}

type tree_state = {
    root: fs_node
    page: HTMLElement
    open: Set<string>
    selected: fs_node | null
    message: HTMLElement | null
    // a new file or folder that has no name yet: its row sits first in the folder, with the name field active (nothing exists until it is named)
    draft: { dir: fs_node, kind: "file" | "dir", value: string } | null
}

let tree: tree_state | null = null
let shared_root: fs_node | null = null

// Uploads stay in a memory directory until explicitly saved into /home/user.
const temporary_files = memory_directory("tmp")
let home_node: fs_node | null = null
let tmp_node: fs_node | null = null
let executable_names: string[] = []
export async function mount_executables(names: string[]): Promise<void> {
    executable_names = names
    const bin = find_node("/bin")
    if (!bin) return
    const directory = memory_directory("bin")
    for (const name of names) {
        const file = await directory.getFileHandle(name, { create: true })
        const writer = await file.createWritable!()
        await writer.write(JSON.stringify({ executable: `/bin/${name}`, runtime: "wasm" }))
        await writer.close()
    }
    bin.handle = directory
    bin.writable = false
    bin.children = null
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
    if (!dir?.writable || !dir.handle) return note(text("files_unsupported"))
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
    if (node.handle && !node.mount) tools.append(button("copy", text("files_copy"), "copy"))
    if (node.kind === "file" && node.handle) tools.append(button("download", text("files_download"), "download"))
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
    box.open = node.kind === "dir" && current.open.has(node.path)
    const head = document.createElement("summary")
    head.className = "desk_side_item_head"
    if (current.selected === node) head.setAttribute("data-selected", "")
    // what lives in a writable folder can be dragged to another one; the markup's own folders and the mounts stay where they are
    if (node.parent?.writable && !node.mount) head.draggable = true
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
    if (current.selected === node && node.parent) box.append(make_item_tools(node))
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
}

export function redraw(): void {
    if (!tree) return
    const holder = tree.page
    holder.replaceChildren(render_node(tree.root, tree))
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
}

function child_of(parent: fs_node, handle: file_handle | dir_handle): fs_node {
    return {
        name: handle.name, path: `${parent.path}/${handle.name}`, kind: handle.kind === "directory" ? "dir" : "file", info: "", parent,
        children: handle.kind === "directory" ? null : [], handle, writable: parent.writable,
    }
}

export async function load_children(node: fs_node): Promise<void> {
    const handle = node.handle as dir_handle | null
    if (!handle) return
    const list: fs_node[] = []
    if (node.mount && !(await allowed(handle))) {
        note(text("files_denied"))
        node.children = []
        return
    }
    try {
        for await (const entry of handle.values()) if (!(node === home_node && entry.name === ".jazu_tmp")) list.push(child_of(node, entry))
    } catch {
        note(text("files_failed"))
    }
    list.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1))
    node.children = list
}

async function write_blob(handle: file_handle, blob: Blob): Promise<void> {
    if (!handle.createWritable) throw new Error(text("files_no_save"))
    const stream = await handle.createWritable()
    await stream.write(blob)
    await stream.close()
}

// ---- opening files ----------------------------------------------------------------------------------------------------------------

async function open_file(node: fs_node): Promise<void> {
    const handle = node.handle as file_handle | null
    if (!handle) return
    // an empty window takes the file; otherwise it gets a window of its own
    const focused = state.focused
    let target: desk_window | null = focused && !focused.file ? focused : null
    target ??= new_window()
    if (!target) return
    try {
        const file = await handle.getFile()
        await load_file(target, file, node.name, `file://${node.path}`)
        // an edit made in the window goes back into the file
        if (node.writable) target.save = blob => write_blob(handle, blob)
        focus_window(target)
    } catch {
        note(text("files_open_failed"))
    }
}

// ---- events -----------------------------------------------------------------------------------------------------------------------

function node_of(element: Element): fs_node | null {
    const article = element.closest<HTMLElement>(".desk_side_item")
    return article?.dataset.path ? find_node(article.dataset.path) : null
}

function select(node: fs_node | null): void {
    if (!tree) return
    tree.selected = node
    for (const head of tree.page.querySelectorAll("[data-selected]")) head.removeAttribute("data-selected")
    if (!node) return
    const article = [...tree.page.querySelectorAll<HTMLElement>(".desk_side_item")].find(item => item.dataset.path === node.path)
    article?.querySelector(":scope > details > summary")?.setAttribute("data-selected", "")
}

function on_click(event: MouseEvent): void {
    if (!tree) return
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
    if (tree.draft) {
        tree.draft = null
        redraw()
    }
    select(node)
    note(node.path === "/home" ? text("files_open_folder") : "")
    if (node.kind === "file") void open_file(node)
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
    buttons.append(button("new_file", text("files_new_file"), "file_new"), button("new_folder", text("files_new_folder"), "folder_new"), button("upload", text("files_upload"), "upload"))
    bar.append(message, buttons)
    if (tree) tree.message = message
    return bar
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

async function allowed(handle: dir_handle): Promise<boolean> {
    if (!handle.queryPermission) return true
    const options = { mode: "readwrite" }
    if ((await handle.queryPermission(options)) === "granted") return true
    return (await handle.requestPermission?.(options)) === "granted"
}

function mount_node(home: fs_node, name: string, handle: dir_handle): fs_node {
    return { name, path: `${home.path}/${name}`, kind: "dir", info: "", parent: home, children: null, handle, writable: true, mount: true }
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
        await with_store("readwrite", store => store.put({ name, handle: node.handle }))
    } catch {
        // kept for this visit only
    }
    const old_path = node.path
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
    if (select_path) tree.selected = find_node(select_path)
    redraw()
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
    if (!parent || !valid_name(name)) return note(text("files_bad_name"))
    if (name === node.name) return clear_form()
    if (parent.children === null) await load_children(parent)
    if (exists_in(parent, name)) return note(text("files_exists"))
    const handle = node.handle as file_handle | dir_handle
    try {
        if (typeof handle.move === "function") await handle.move(name)
        else {
            await copy_into(handle, parent.handle as dir_handle, name)
            await (parent.handle as dir_handle).removeEntry(node.name, { recursive: true })
        }
    } catch {
        return note(text("files_failed"))
    }
    const old_path = node.path
    const new_path = `${parent.path}/${name}`
    clear_form()
    note("")
    // open folders and windows that pointed into the old path follow the new one
    if (tree) tree.open = new Set([...tree.open].map(path => (path === old_path || path.startsWith(`${old_path}/`) ? new_path + path.slice(old_path.length) : path)))
    for (const item of state.windows) {
        if (item.path === `file://${old_path}`) {
            item.path = `file://${new_path}`
            item.name = name
        } else if (item.path.startsWith(`file://${old_path}/`)) item.path = `file://${new_path}${item.path.slice(`file://${old_path}`.length)}`
    }
    await reload(parent, new_path)
    for (const item of state.windows) {
        if (!item.path.startsWith("file://")) continue
        // the old File object points at the old name: read the file again from its handle
        if (item.path === `file://${new_path}` && node.kind === "file") {
            try {
                item.file = await (handle as file_handle).getFile()
            } catch {
                item.file = null
            }
        }
        window_refresh(item)
    }
}

async function delete_entry(node: fs_node): Promise<void> {
    const parent = node.parent
    if (!parent) return
    try {
        await (parent.handle as dir_handle).removeEntry(node.name, { recursive: true })
    } catch {
        return note(text("files_failed"))
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

// a free name next to the original: "a.txt" -> "a copy.txt" -> "a copy 2.txt"
function copy_name(dir: fs_node, name: string): string {
    const dot = name.lastIndexOf(".")
    const stem = dot > 0 ? name.slice(0, dot) : name
    const ext = dot > 0 ? name.slice(dot) : ""
    let candidate = `${stem} copy${ext}`
    for (let count = 2; exists_in(dir, candidate); count++) candidate = `${stem} copy ${count}${ext}`
    return candidate
}

async function copy_entry(node: fs_node): Promise<void> {
    const parent = node.parent
    if (!parent?.writable || !node.handle) return note(text("files_unsupported"))
    if (parent.children === null) await load_children(parent)
    const name = copy_name(parent, node.name)
    try {
        await copy_into(node.handle as file_handle | dir_handle, parent.handle as dir_handle, name)
    } catch {
        return note(text("files_failed"))
    }
    note("")
    await reload(parent, `${parent.path}/${name}`)
}

async function download_entry(node: fs_node): Promise<void> {
    if (node.kind !== "file" || !node.handle) return
    try {
        const file = await (node.handle as file_handle).getFile()
        const url = URL.createObjectURL(file)
        const link = document.createElement("a")
        link.href = url
        link.download = node.name
        document.body.append(link)
        link.click()
        link.remove()
        setTimeout(() => URL.revokeObjectURL(url), 10000)
    } catch {
        note(text("files_failed"))
    }
}

// The folder a new item goes into: the selected folder, the folder of the selected file, or /home/user when nothing is selected.
function create_target(): fs_node | null {
    const picked = tree?.selected ? target_dir(tree.selected) : null
    return picked ?? find_node("/home/user")
}

function run_action(action: string, node: fs_node | null): void {
    if (!tree) return
    note("")
    if (tree.draft && action !== "new_file" && action !== "new_folder") tree.draft = null
    if (action === "new_file" || action === "new_folder") {
        void start_create(action === "new_file" ? "file" : "dir")
        return
    }
    if (action === "upload") {
        // on /home, Upload brings in a whole folder from the computer
        if (node?.path === "/home") {
            clear_form()
            void pick_folder()
            return
        }
        const store = tmp_node?.handle ? tmp_node : node ? target_dir(node) : null
        if (!store?.writable) return note(text("files_unsupported"))
        clear_form()
        pick_files(store)
        return
    }
    if (!node) return note(text("files_no_selection"))
    if (action === "rename") {
        if (node.mount) return show_form(text("files_name"), node.name, [{ text: text("files_ok"), done: value => rename_mount(node, value) }])
        if (!node.parent?.writable) return note(text("files_unsupported"))
        show_form(text("files_name"), node.name, [{ text: text("files_ok"), done: value => rename_entry(node, value) }])
    } else if (action === "delete") {
        if (node.mount) return show_form(`${text("files_confirm_delete")} ${node.name}`, null, [{ text: text("files_delete"), done: () => forget_mount(node) }])
        if (!node.parent?.writable) return note(text("files_unsupported"))
        show_form(`${text("files_confirm_delete")} ${node.name}`, null, [{ text: text("files_delete"), done: () => delete_entry(node) }])
    } else if (action === "copy") void copy_entry(node)
    else if (action === "download") void download_entry(node)
}

// ---- moving by drag and drop ----------------------------------------------------------------------------------------------------
// Only what lives in a writable folder (/home/user, /tmp, a picked folder) moves, and only into another writable folder: the system folders
// described by the markup are neither sources nor targets.

let dragged: fs_node | null = null

function can_drop(node: fs_node, onto: fs_node): fs_node | null {
    const dir = target_dir(onto)
    if (!dir || !dir.writable || !dir.handle || !node.parent?.writable || node.mount) return null
    if (dir === node.parent || dir === node) return null
    if (dir.path === node.path || dir.path.startsWith(`${node.path}/`)) return null
    return dir
}

async function move_entry(node: fs_node, dir: fs_node): Promise<void> {
    const from = node.parent
    if (!from) return
    if (dir.children === null) await load_children(dir)
    if (exists_in(dir, node.name)) return note(text("files_exists"))
    const handle = node.handle as file_handle | dir_handle
    const to = dir.handle as dir_handle
    try {
        // a handle moves inside one file system (OPFS); between a picked folder and OPFS it is copied, and the old one removed once the copy is whole
        let moved = false
        if (typeof handle.move === "function") {
            try {
                await (handle.move as unknown as (parent: dir_handle, name: string) => Promise<void>)(to, node.name)
                moved = true
            } catch {
                moved = false
            }
        }
        if (!moved) {
            await copy_into(handle, to, node.name)
            await (from.handle as dir_handle).removeEntry(node.name, { recursive: true })
        }
    } catch {
        return note(text("files_failed"))
    }
    const old_path = node.path
    const new_path = `${dir.path}/${node.name}`
    note("")
    if (tree) tree.open = new Set([...tree.open].map(path => (path === old_path || path.startsWith(`${old_path}/`) ? new_path + path.slice(old_path.length) : path)))
    for (const item of state.windows) {
        if (item.path === `file://${old_path}` || item.path.startsWith(`file://${old_path}/`)) item.path = `file://${new_path}${item.path.slice(`file://${old_path}`.length)}`
    }
    await reload(from)
    await reload(dir, new_path)
    for (const item of state.windows) {
        if (!item.path.startsWith("file://")) continue
        if (item.path === `file://${new_path}` && node.kind === "file") {
            try {
                item.file = await ((find_node(new_path)?.handle ?? handle) as file_handle).getFile()
            } catch {
                item.file = null
            }
        }
        window_refresh(item)
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
        dragged = node
        event.dataTransfer?.setData("text/plain", node.path)
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "move"
    })
    page.addEventListener("dragover", event => {
        const head = drop_head(event)
        const onto = head ? node_of(head) : null
        clear_drop_marks()
        if (!dragged || !head || !onto || !can_drop(dragged, onto)) return
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
        const node = dragged
        dragged = null
        clear_drop_marks()
        const dir = node && onto ? can_drop(node, onto) : null
        if (!node || !dir) return
        event.preventDefault()
        void move_entry(node, dir)
    })
    page.addEventListener("dragend", () => {
        dragged = null
        clear_drop_marks()
    })
}

// /home/user is the browser's private file system for this site (OPFS): it is kept between visits, and only this site can see it.
function mount_opfs(root: fs_node): void {
    const home = find_node("/home", root)
    const user = find_node("/home/user", root)
    const tmp = find_node("/tmp", root)
    const storage = navigator.storage as { getDirectory?: () => Promise<dir_handle> } | undefined
    home_node = user
    tmp_node = tmp
    if (tmp) { tmp.handle = temporary_files; tmp.writable = true; tmp.children = null }
    if (!home || !user || !storage?.getDirectory) return
    user.writable = true
    user.children = null
    void storage.getDirectory().then(async handle => {
        user.handle = handle
        redraw()
    }).catch(() => {
        user.writable = false
        user.children = []
    })
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

export function init_fs(desk: HTMLElement): void {
    const page = desk.querySelector<HTMLElement>('.desk_side_page[data-path="file:///"]')
    const root_box = page?.querySelector(":scope > .desk_side_item")
    if (!page || !root_box) {
        tree = null
        return
    }
    const root = shared_root ?? read_markup(root_box, null)
    shared_root = root
    tree = { root, page, open: new Set(["/", "/home"]), selected: null, message: null, draft: null }
    upload_hooks.store = store_upload
    mount_opfs(root)
    void mount_executables(executable_names)
    redraw()
    void restore_mounts(root)
    document.dispatchEvent(new Event("jazu:fs:init"))
    // the bar sits under the tree, in the panel itself, so it stays in view while the tree scrolls
    const side = page.closest(".desk_side")
    const bar = make_bar()
    bar.addEventListener("click", on_bar_click)
    side?.append(bar)
    if (!page.dataset.bound) {
        page.dataset.bound = "1"
        page.addEventListener("click", on_click)
        page.addEventListener("toggle", on_toggle, true)
        bind_drag(page)
    }
}
