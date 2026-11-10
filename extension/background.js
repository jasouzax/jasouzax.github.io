/*
 * Service worker: approves the page, then relays its messages to the native host and back.
 * Entities:
 *   host_name       - the native messaging host this extension may start (see host/install.ts)
 *   page_types      - the only message types a page may send; everything else is dropped here and validated again by the host
 *   chrome.runtime.onConnect - one page port owns one native host process, so closing the page ends its shells
 * Scope:
 *   Never listens for external connections (no externally_connectable): only this extension's own content script can reach it.
 *   The page origin comes from the browser (port.sender), never from message content.
 */
"use strict"

const host_name = "jazu.desk.host"
const page_types = new Set(["hello", "open", "input", "resize", "close"])
const host_timeout_ms = 8000

async function allowed_origins() {
    const response = await fetch(chrome.runtime.getURL("allowed_origins.json"))
    const list = await response.json()
    return Array.isArray(list) ? list.filter(item => typeof item === "string") : []
}

async function approve(port) {
    const sender = port.sender
    if (!sender || sender.frameId !== 0 || !sender.tab) return "only a top-level tab may use the bridge"
    const origins = await allowed_origins()
    if (!origins.includes(sender.origin)) return `${sender.origin} is not in allowed_origins.json`
    return ""
}

function attach_host(port, on_gone) {
    const host = chrome.runtime.connectNative(host_name)
    host.onMessage.addListener(message => port.postMessage(message))
    host.onDisconnect.addListener(() => {
        const reason = chrome.runtime.lastError?.message ?? "the host exited"
        on_gone()
        port.postMessage({ type: "host_error", message: reason })
    })
    return host
}

chrome.runtime.onConnect.addListener(port => {
    if (port.name !== "jazu-desk") return
    const verdict = approve(port)
    let host = null
    port.onMessage.addListener(async message => {
        const refusal = await verdict
        if (refusal) {
            port.postMessage({ type: "host_error", message: refusal })
            return
        }
        if (!message || typeof message.type !== "string" || !page_types.has(message.type)) return
        if (message.type === "hello") {
            port.postMessage({ type: "hello", extension: chrome.runtime.getManifest().version, timeout_ms: host_timeout_ms })
            host ??= attach_host(port, () => { host = null })
            return
        }
        host?.postMessage(message)
    })
    port.onDisconnect.addListener(() => {
        host?.disconnect()
        host = null
    })
})
