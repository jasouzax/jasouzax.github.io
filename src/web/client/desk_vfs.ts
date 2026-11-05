// The file system as a process sees it (fs_api, client_proc_types.ts): the desk's file tree (client_desk_fs.ts: /home/user in OPFS, /tmp, folders
// the visitor picked), with /bin (the programs), /proc (the processes) and /dev/null made by the kernel on top. Errors carry the usual messages.

import type { fs_api, stat_info } from "./proc_types.ts"
import type { fs_node, file_handle, dir_handle } from "./desk_fs.ts"
import { fs_root, load_children, refresh_dir } from "./desk_fs.ts"
import { list_procs, kernel } from "./kernel.ts"

type kind = "file" | "dir"

function norm(path: string): string {
    const parts: string[] = []
    for (const part of path.split("/")) {
        if (part === "" || part === ".") continue
        if (part === "..") parts.pop()
        else parts.push(part)
    }
    return "/" + parts.join("/")
}

async function resolve(path: string): Promise<fs_node | null> {
    let node = fs_root()
    if (!node) return null
    for (const part of norm(path).split("/").filter(Boolean)) {
        if (node.kind !== "dir") return null
        if (node.children === null) await load_children(node)
        node = (node.children ?? []).find(child => child.name === part) ?? null
        if (!node) return null
    }
    return node
}

async function list_node(node: fs_node): Promise<fs_node[]> {
    if (node.children === null) await load_children(node)
    return node.children ?? []
}

function writable_dir(node: fs_node | null): dir_handle {
    if (!node) throw new Error("No such file or directory")
    if (node.kind !== "dir") throw new Error("Not a directory")
    if (!node.writable || !node.handle) throw new Error("Read-only file system")
    return node.handle as dir_handle
}

function split_parent(path: string): { dir: string, name: string } {
    const clean = norm(path)
    const at = clean.lastIndexOf("/")
    return { dir: at <= 0 ? "/" : clean.slice(0, at), name: clean.slice(at + 1) }
}

// ---- what the kernel adds -----------------------------------------------------------------------------------------------------

function proc_file(pid: number, name: string): string | null {
    const item = kernel.table.get(pid)
    if (!item) return null
    if (name === "cmdline") return item.argv.join(" ") + "\n"
    if (name === "status") return `Name:\t${item.argv[0]}\nPid:\t${item.pid}\nPPid:\t${item.ppid}\nState:\t${item.running ? "R (running)" : "Z (exited)"}\n`
    if (name === "cwd") return item.cwd + "\n"
    return null
}

function virtual_stat(path: string, programs: string[]): stat_info | null {
    const clean = norm(path)
    if (clean === "/dev/null") return { kind: "file", size: 0, writable: true }
    if (clean === "/proc") return { kind: "dir", size: 0, writable: false }
    const proc_match = /^\/proc\/(\d+)(?:\/([a-z]+))?$/.exec(clean)
    if (proc_match) {
        const pid = Number(proc_match[1])
        if (!kernel.table.has(pid)) return null
        if (!proc_match[2]) return { kind: "dir", size: 0, writable: false }
        const text = proc_file(pid, proc_match[2])
        return text === null ? null : { kind: "file", size: text.length, writable: false }
    }
    const bin = /^\/bin\/([^/]+)$/.exec(clean)
    if (bin && programs.includes(bin[1])) return { kind: "file", size: 0, writable: false }
    return null
}

export function make_fs(programs: () => string[]): fs_api {
    const api: fs_api = {
        async stat(path) {
            const virtual = virtual_stat(path, programs())
            if (virtual) return virtual
            const node = await resolve(path)
            if (!node) return null
            if (node.kind === "dir") return { kind: "dir", size: 0, writable: node.writable }
            let size = 0
            try {
                size = (await (node.handle as file_handle | null)?.getFile())?.size ?? 0
            } catch {
                size = 0
            }
            return { kind: "file", size, writable: node.writable }
        },
        async list(path) {
            const clean = norm(path)
            const out = new Map<string, kind>()
            if (clean === "/proc") {
                for (const item of list_procs()) out.set(String(item.pid), "dir")
                return [...out].map(([name, kind]) => ({ name, kind }))
            }
            const proc_dir = /^\/proc\/(\d+)$/.exec(clean)
            if (proc_dir && kernel.table.has(Number(proc_dir[1]))) return ["cmdline", "status", "cwd"].map(name => ({ name, kind: "file" as const }))
            const node = await resolve(clean)
            if (!node && clean !== "/bin" && clean !== "/dev") throw new Error("No such file or directory")
            if (node && node.kind !== "dir") throw new Error("Not a directory")
            for (const child of node ? await list_node(node) : []) out.set(child.name, child.kind)
            if (clean === "/bin") for (const name of programs()) out.set(name, "file")
            if (clean === "/dev") out.set("null", "file")
            if (clean === "/") out.set("proc", "dir")
            return [...out].map(([name, kind]) => ({ name, kind }))
        },
        async read(path) {
            const clean = norm(path)
            if (clean === "/dev/null") return ""
            const proc_match = /^\/proc\/(\d+)\/([a-z]+)$/.exec(clean)
            if (proc_match) {
                const text = proc_file(Number(proc_match[1]), proc_match[2])
                if (text !== null) return text
            }
            if (virtual_stat(clean, programs())?.kind === "file" && clean.startsWith("/bin/")) return `#!/bin/sh\n# ${clean.slice(5)} is built into the shell runtime\n`
            const node = await resolve(clean)
            if (!node) throw new Error("No such file or directory")
            if (node.kind === "dir") throw new Error("Is a directory")
            const handle = node.handle as file_handle | null
            if (!handle) throw new Error("Permission denied")
            return (await handle.getFile()).text()
        },
        async write(path, data, append = false) {
            const clean = norm(path)
            if (clean === "/dev/null") return
            const { dir, name } = split_parent(clean)
            if (!name) throw new Error("Is a directory")
            const parent = await resolve(dir)
            const handle = writable_dir(parent)
            const existing = (await list_node(parent!)).find(child => child.name === name)
            if (existing?.kind === "dir") throw new Error("Is a directory")
            let text = data
            if (append && existing) text = (await (await handle.getFileHandle(name)).getFile().then(file => file.text())) + data
            const file = await handle.getFileHandle(name, { create: true })
            if (!file.createWritable) throw new Error("Read-only file system")
            const stream = await file.createWritable()
            await stream.write(text)
            await stream.close()
            if (!existing) await refresh_dir(parent!)
        },
        async mkdir(path) {
            const { dir, name } = split_parent(path)
            const parent = await resolve(dir)
            const handle = writable_dir(parent)
            if ((await list_node(parent!)).some(child => child.name === name)) throw new Error("File exists")
            await handle.getDirectoryHandle(name, { create: true })
            await refresh_dir(parent!)
        },
        async remove(path, recursive = false) {
            const clean = norm(path)
            const node = await resolve(clean)
            if (!node || !node.parent) throw new Error("No such file or directory")
            const handle = writable_dir(node.parent)
            if (node.kind === "dir" && !recursive && (await list_node(node)).length > 0) throw new Error("Directory not empty")
            await handle.removeEntry(node.name, { recursive })
            await refresh_dir(node.parent)
        },
        async rename(from, to) {
            const source = await resolve(from)
            if (!source || !source.parent) throw new Error("No such file or directory")
            writable_dir(source.parent)
            const { dir, name } = split_parent(to)
            const target_dir = await resolve(dir)
            const target = writable_dir(target_dir)
            const same = target_dir === source.parent
            const handle = source.handle as file_handle | dir_handle
            if (same && typeof handle.move === "function") await handle.move(name)
            else {
                const copy = async (from_handle: file_handle | dir_handle, into: dir_handle, new_name: string): Promise<void> => {
                    if (from_handle.kind === "file") {
                        const out = await into.getFileHandle(new_name, { create: true })
                        const stream = await out.createWritable!()
                        await stream.write(await from_handle.getFile())
                        await stream.close()
                        return
                    }
                    const made = await into.getDirectoryHandle(new_name, { create: true })
                    for await (const entry of from_handle.values()) await copy(entry, made, entry.name)
                }
                await copy(handle, target, name)
                await (source.parent.handle as dir_handle).removeEntry(source.name, { recursive: true })
            }
            await refresh_dir(source.parent)
            if (!same) await refresh_dir(target_dir!)
        },
    }
    return api
}
