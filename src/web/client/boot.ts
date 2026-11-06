import { capture_skeleton } from "./loading.ts"
const root = document.documentElement
root.classList.add("js")
root.dataset.skeleton = "loading"
const skeleton_observer = new MutationObserver(() => {
    if (!document.querySelector(".site_foot")) return
    skeleton_observer.disconnect()
    capture_skeleton()
})
skeleton_observer.observe(document.documentElement, { childList: true, subtree: true })
const boot_window = window as Window & { jazu_boot_css?: Promise<void> }
boot_window.jazu_boot_css = new Promise<void>(done => {
    const timer = setTimeout(done, 12000)
    document.addEventListener("load", event => {
        const link = event.target
        if (!(link instanceof HTMLLinkElement)) return
        if (link.hasAttribute("data-page-media")) link.media = link.dataset.pageMedia ?? "all"
        if (link.id !== "theme_css") return
        // Activated after the runtime captures the neutral layout.
        link.dataset.loaded = "true"
        clearTimeout(timer)
        done()
    }, true)
    document.addEventListener("error", event => {
        const link = event.target
        if (link instanceof HTMLLinkElement && link.id === "theme_css") {
            link.dataset.failed = "true"
            clearTimeout(timer)
            done()
        }
    }, true)
})
try {
    const mode = localStorage.getItem("jazu_mode")
    if (mode && ["auto", "light", "dark"].includes(mode)) root.dataset.mode = mode
    if (!sessionStorage.getItem("jazu_intro")) {
        sessionStorage.setItem("jazu_intro", "1")
        root.classList.add("intro")
    }
} catch {}
setTimeout(() => root.classList.remove("intro"), 1500)
// Fail open if a runtime or stylesheet is unavailable, including restrictive
// extensions. The inline layout remains usable with readable system fonts.
setTimeout(() => {
    if (!root.classList.contains("theme_ready")) {
        document.getElementById("loading_overlay")?.remove()
        delete root.dataset.skeleton
        const main = document.getElementById("main-content")
        if (main) { main.inert = false; main.setAttribute("aria-busy", "false") }
    }
}, 12000)
