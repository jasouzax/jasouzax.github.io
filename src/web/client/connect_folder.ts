import { connect_home } from "./home_directory.ts"
import type { dir_handle } from "./desk_fs.ts"

export function init_connect_folder(): void {
    let busy = false
    const picker = (window as unknown as { showDirectoryPicker?: (options: { id: string, mode: string }) => Promise<dir_handle> }).showDirectoryPicker
    const paint = () => {
        for (const button of document.querySelectorAll<HTMLButtonElement>("[data-connect-folder]")) {
            button.disabled = !picker || busy
            if (!picker) button.title = button.dataset.unsupported ?? ""
        }
    }
    document.addEventListener("jazu:page", paint)
    paint()
    document.addEventListener("click", event => {
        const button = (event.target as Element).closest<HTMLButtonElement>("[data-connect-folder]")
        if (!button || !picker || busy) return
        event.preventDefault()
        // Open the picker in the click's activation, before any storage awaits.
        const selection = picker.call(window, { id: "jazu-home", mode: "readwrite" })
        const status = button.closest(".list_drop")?.querySelector<HTMLElement>("[data-folder-status]")
        const message = (text: string) => { if (status) { status.hidden = !text; status.textContent = text } }
        busy = true; paint(); message(button.dataset.connecting ?? "")
        void (async () => {
            try {
                const handle = await selection
                const result = await connect_home(handle)
                message(`${handle.name}: ${result.persistent ? button.dataset.connected : button.dataset.session}`)
            } catch (error) {
                message(error instanceof DOMException && error.name === "AbortError" ? "" : `${button.dataset.failed}: ${error instanceof Error ? error.message : String(error)}`)
            } finally { busy = false; paint() }
        })()
    })
}
