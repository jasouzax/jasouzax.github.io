const root = document.documentElement
root.classList.add("js")
try {
    const mode = localStorage.getItem("jazu_mode")
    if (mode) root.dataset.mode = mode
    if (!sessionStorage.getItem("jazu_intro")) {
        sessionStorage.setItem("jazu_intro", "1")
        root.classList.add("intro")
    }
} catch {}
setTimeout(() => root.classList.remove("intro"), 1500)
