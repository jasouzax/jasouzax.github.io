/* Only the pinned top-level localhost document may own a native host; reloads end its shells. */
import { ipcMain, type BrowserWindow } from "electron"
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { join } from "node:path"
import { Frame_Reader, encode_frame } from "../../shared/host/frame.ts"
import { parse_request } from "../../shared/host/protocol.ts"
import { desktop_service } from "./desktop.ts"

export function attach_host(window: BrowserWindow, origin: string, directory: string): void {
    let host: ChildProcessWithoutNullStreams | null = null
    const desktop = desktop_service(window)
    let generation = 0, active = 0
    const send = (message: unknown) => { if (!window.isDestroyed()) window.webContents.send("jazu-host", message) }
    const close = () => { generation++; host?.stdin.end(); host = null }
    const receive = (event: Electron.IpcMainEvent, message: unknown) => {
        if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || new URL(event.senderFrame.url).origin !== origin) return
        try {
            const value = message as { type?: string, id?: number, request?: unknown }
            if (value?.type === "desktop") {
                if (!Number.isSafeInteger(value.id) || value.id! < 1 || active >= 32) return
                const epoch = generation
                active++
                void desktop(value.request).then(result => { if (epoch === generation) send({ type: "desktop_result", id: value.id, result }) }, error => { if (epoch === generation) send({ type: "desktop_result", id: value.id, error: { message: error.message, code: error.code || "EIO" } }) }).finally(() => active--)
                return
            }
            if (value?.type === "hello") {
                send({ type: "hello", extension: "electron", timeout_ms: 8000 })
                if (host) return
                const child = host = spawn(process.execPath, [join(directory, "host.cjs")], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, stdio: "pipe", windowsHide: true })
                const reader = new Frame_Reader()
                child.stdin.on("error", () => { if (host === child) close() })
                child.stdout.on("data", bytes => { if (host !== child) return; try { for (const reply of reader.push(bytes)) send(reply) } catch { close(); send({ type: "host_error", message: "Invalid native host frame" }) } })
                child.stderr.on("data", bytes => process.stderr.write(bytes))
                child.once("error", () => { if (host === child) host = null; send({ type: "host_error", message: "Native host could not start" }) })
                child.once("exit", () => { if (host === child) { host = null; send({ type: "host_closed" }) } })
                return
            }
            parse_request(message)
            if (host && host.stdin.writableLength < 4 * 1024 * 1024) host.stdin.write(encode_frame(message))
        } catch { send({ type: "host_error", message: "Invalid native request" }) }
    }
    ipcMain.on("jazu-host", receive)
    window.webContents.on("did-start-navigation", (_event, _url, _in_place, main) => { if (main) close() })
    window.once("closed", () => { close(); ipcMain.removeListener("jazu-host", receive) })
}
