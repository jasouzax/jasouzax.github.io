import { load_children, refresh_dir, type dir_handle, type file_handle, type fs_node } from "./desk_fs.ts"
import { can_create, check_permissions } from "./desk_fs_permissions.ts"
import { available_name } from "./desk_files_util.ts"
import { text } from "./desk.ts"

export type imported_entry =
    | { name: string, kind: "file", file: () => Promise<File> }
    | { name: string, kind: "directory", entries: () => AsyncIterable<imported_entry> }

type legacy_entry = {
    name: string, isDirectory: boolean
    file: (done: (file: File) => void, fail: (error: unknown) => void) => void
    createReader: () => { readEntries: (done: (entries: legacy_entry[]) => void, fail: (error: unknown) => void) => void }
}

function from_handle(handle: file_handle | dir_handle): imported_entry {
    if (handle.kind === "file") return { kind: "file", name: handle.name, file: () => handle.getFile() }
    return { kind: "directory", name: handle.name, entries: async function* () {
        for await (const child of handle.values()) yield from_handle(child)
    } }
}

function from_legacy(entry: legacy_entry): imported_entry {
    if (!entry.isDirectory) return { kind: "file", name: entry.name, file: () => new Promise((resolve, reject) => entry.file(resolve, reject)) }
    return { kind: "directory", name: entry.name, entries: async function* () {
        const reader = entry.createReader()
        while (true) {
            const batch = await new Promise<legacy_entry[]>((resolve, reject) => reader.readEntries(resolve, reject))
            if (!batch.length) return
            for (const child of batch) yield from_legacy(child)
        }
    } }
}

// Capture native handles during the drop event, before its protected data expires.
export function capture_imports(data: DataTransfer): Promise<imported_entry[]> {
    const items = [...data.items].filter(item => item.kind === "file")
    if (!items.length) return Promise.resolve([...data.files].map(file => ({ kind: "file", name: file.name, file: async () => file })))
    return Promise.all(items.map(item => {
        const modern = item as DataTransferItem & { getAsFileSystemHandle?: () => Promise<file_handle | dir_handle | null> }
        let legacy: legacy_entry | null = null
        try { legacy = item.webkitGetAsEntry?.() as unknown as legacy_entry | null } catch { /* modern handles or files may still be available */ }
        const file = item.getAsFile()
        let handle: Promise<file_handle | dir_handle | null> = Promise.resolve(null)
        try { handle = modern.getAsFileSystemHandle?.() ?? handle } catch { /* legacy readers remain available */ }
        return handle.catch(() => null).then(found => found ? from_handle(found) : legacy ? from_legacy(legacy) : file ? { kind: "file" as const, name: file.name, file: async () => file } : null)
    })).then(entries => entries.filter((entry): entry is imported_entry => entry !== null))
}

async function write_entry(parent: dir_handle, name: string, entry: imported_entry): Promise<void> {
    if (!name || /[/\\\0]/.test(name) || name === "." || name === "..") throw new Error(text("files_bad_name"))
    if (entry.kind === "file") {
        const file = await entry.file()
        const handle = await parent.getFileHandle(name, { create: true })
        if (!handle.createWritable) throw new Error(text("files_unsupported"))
        const writer = await handle.createWritable()
        await writer.write(file); await writer.close()
    } else {
        const dir = await parent.getDirectoryHandle(name, { create: true })
        const names = new Set<string>()
        for await (const child of entry.entries()) {
            const name = available_name(child.name, names)
            names.add(name)
            await write_entry(dir, name, child)
        }
    }
}

export async function import_entries(dir: fs_node, entries: imported_entry[]): Promise<void> {
    await check_permissions([dir])
    if (!can_create(dir)) throw new Error(text("files_unsupported"))
    await load_children(dir)
    const names = new Set((dir.children ?? []).map(node => node.name))
    try {
        for (const entry of entries) {
            const name = available_name(entry.name, names)
            await write_entry(dir.handle as dir_handle, name, entry)
            names.add(name)
        }
    } finally { await refresh_dir(dir) }
}
