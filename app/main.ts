/* Independent Electron desktop. Native IPC is restricted to its own local website, never a remote page. */
import { app, BrowserWindow, shell } from "electron"
import { join } from "node:path"
import { attach_host } from "./host/ipc.ts"

const url = new URL(process.env.JAZU_APP_URL || "http://localhost:8080/desk")
if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.username || url.password) throw new Error("JAZU_APP_URL must be a localhost HTTP URL")
if (!app.requestSingleInstanceLock()) app.quit()
else app.whenReady().then(async () => {
    const window = new BrowserWindow({ width: 1440, height: 1000, title: "JAZU Desktop", fullscreen: process.argv.includes("--kiosk"), autoHideMenuBar: true, webPreferences: { preload: join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true } })
    attach_host(window, url.origin, __dirname)
    window.webContents.setWindowOpenHandler(({ url: target }) => { if (/^https?:/.test(target)) void shell.openExternal(target); return { action: "deny" } })
    window.webContents.on("will-navigate", (event, target) => { if (new URL(target).origin !== url.origin) event.preventDefault() })
    window.webContents.on("will-redirect", (event, target) => { if (new URL(target).origin !== url.origin) event.preventDefault() })
    window.webContents.on("will-attach-webview", event => event.preventDefault())
    window.webContents.session.setPermissionRequestHandler((contents, permission, callback, details) => callback(contents === window.webContents && new URL(details.requestingUrl).origin === url.origin && ["media", "clipboard-sanitized-write"].includes(permission)))
    app.on("second-instance", () => { if (window.isMinimized()) window.restore(); window.focus() })
    await window.loadURL(url.href)
})
app.on("window-all-closed", () => app.quit())
