/* Sandboxed preload exposes only the existing validated host message envelope. */
import { ipcRenderer } from "electron"
const origin = location.origin
window.addEventListener("message", event => {
    if (event.source !== window || event.origin !== origin) return
    const data = event.data
    if (data?.channel !== "jazu-host" || data.direction !== "to_host" || !data.message || typeof data.message !== "object") return
    ipcRenderer.send("jazu-host", data.message)
})
ipcRenderer.on("jazu-host", (_event, message) => window.postMessage({ channel: "jazu-host", direction: "to_page", message }, origin))
