let registration: Promise<ServiceWorkerRegistration | null> | undefined
export function pwa_registration(): Promise<ServiceWorkerRegistration | null> {
    return registration ??= (async () => {
        if (!("serviceWorker" in navigator) || !isSecureContext) return null
        const response = await fetch("/manifest.json", { cache: "no-cache" })
        if (!response.ok || !(await response.json()).jazu?.pwa?.enabled) return null
        return navigator.serviceWorker.register("/service-worker.js", { scope: "/", updateViaCache: "none" })
    })().catch(() => null)
}
export function init_pwa(): void {
    window.addEventListener("load", () => { void pwa_registration() }, { once: true })
    if (document.readyState === "complete") void pwa_registration()
    const paint = () => {
        document.documentElement.toggleAttribute("data-offline", !navigator.onLine)
        const labels = document.querySelector<HTMLElement>("[data-notifications]")?.dataset
        let banner = document.getElementById("pwa_offline")
        if (navigator.onLine) { banner?.remove(); return }
        if (!banner) { banner = document.createElement("p"); banner.id = "pwa_offline"; banner.className = "pwa_offline"; banner.setAttribute("role", "status"); document.body.append(banner) }
        banner.textContent = labels?.offlineLabel ?? "Offline · Public pages and themes are available. Desk and messaging require a connection."
    }
    window.addEventListener("online", paint); window.addEventListener("offline", paint); document.addEventListener("jazu:page", paint); paint()
}
