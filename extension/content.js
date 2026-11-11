/*
 * Content script: the only code that runs inside the page's origin.
 * Entities:
 *   relay   - copies messages between the page (window.postMessage) and the service worker (one runtime port)
 * Scope:
 *   Holds no policy. Origin approval and message validation happen in background.js, which sees the browser-verified sender.
 *   Only same-window, same-origin messages in the "jazu-host" envelope are accepted from the page.
 */
"use strict"

const channel = "jazu-host"
let port = null

function to_page(message) {
    window.postMessage({ channel, direction: "to_page", message }, location.origin)
}

function open_port() {
    port = chrome.runtime.connect({ name: "jazu-desk" })
    port.onMessage.addListener(to_page)
    // the worker was stopped or the host died: the page must hear it, or its terminals would hang silently
    port.onDisconnect.addListener(() => {
        port = null
        to_page({ type: "host_closed" })
    })
}

window.addEventListener("message", event => {
    if (event.source !== window || event.origin !== location.origin) return
    const data = event.data
    if (!data || data.channel !== channel || data.direction !== "to_host") return
    if (!port) open_port()
    port.postMessage(data.message)
})
