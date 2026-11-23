/* Desktop RPC remains in Electron's main process; only the owning top-level localhost frame may call it. */
import { clipboard, type BrowserWindow } from "electron"
import { homedir, userInfo } from "node:os"
import { isAbsolute, join, parse, relative, resolve, sep } from "node:path"
import { access } from "node:fs/promises"
import { parse_desktop_request, type Desktop_Info } from "../../shared/host/desktop.ts"
import { confine, handle_fs } from "../../shared/host/fs.ts"
import { Window_Manager, detect_wm } from "../wm.ts"
import { Native_IO } from "../io.ts"

export function desktop_service(window: BrowserWindow): (request: unknown) => Promise<unknown> {
    const root = resolve(process.env.JAZU_APP_ROOT || parse(homedir()).root)
    const wm = process.platform === "linux" ? detect_wm() : null
    const manager = wm ? new Window_Manager(wm) : null, io = new Native_IO()
    const virtual_path = (path: string) => {
        if (!path.startsWith("/") || path.includes("\\") || path.split("/").includes("..")) throw new Error("Expected an absolute desktop filesystem path")
        return join(root, ...path.split("/").filter(Boolean))
    }
    const info = async (): Promise<Desktop_Info> => {
        await access(root)
        const home = relative(root, homedir())
        const inside = home !== ".." && !home.startsWith(`..${sep}`) && !isAbsolute(home)
        return { platform: process.platform, home: inside ? `/${home.split(sep).join("/")}` : "/", root, user: userInfo().username, wm, audio: process.platform === "linux", input: process.platform === "linux" && !!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY }
    }
    return async (value: unknown) => {
        const request = parse_desktop_request(value)
        switch (request.op) {
            case "info": return info()
            case "fs": {
                const data = request.request
                const path = await confine(root, virtual_path(data.path))
                const translated = "to" in data ? { ...data, path, to: await confine(root, virtual_path(data.to)) } : { ...data, path }
                // A desktop may browse its root, but deleting or moving the root itself is never a useful file-manager action.
                if (path === root && ["remove", "rename", "copy"].includes(data.op)) throw new Error("Cannot modify the desktop filesystem root")
                return handle_fs(root, translated)
            }
            case "clipboard_read": return { text: await clipboard.readText() }
            case "clipboard_write": await clipboard.writeText(request.text); return {}
            case "volume": return io.volume(request.level, request.muted)
            case "key": await io.key(request.key); return {}
            case "windows": return manager ? (await manager.windows()).filter(item => item.title !== window.getTitle()) : []
            default: {
                if (!manager) throw new Error("No supported window manager is available")
                // Reject stale window IDs, and never manipulate the desktop's own frame through this interface.
                const windows = await manager.windows(), target = windows.find(item => item.id === request.id)
                if (!target || target.title === window.getTitle()) throw new Error("The native window is no longer available")
                await manager.act(request.op, request.id, request.op === "place" ? request.rect : undefined)
                return {}
            }
        }
    }
}
