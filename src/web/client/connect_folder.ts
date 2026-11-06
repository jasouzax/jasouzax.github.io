import { connect_home, disconnect_home, authorize_home, home_directory, type home_mount } from "./home_directory.ts"
import type { dir_handle } from "./desk_fs.ts"

export function init_connect_folder(): void {
    let busy = false, mount: home_mount | null = null
    const picker = (window as unknown as { showDirectoryPicker?: (options: { id: string, mode: string }) => Promise<dir_handle> }).showDirectoryPicker
    const paint = () => {
        for (const button of document.querySelectorAll<HTMLButtonElement>("[data-connect-folder]")) {
            button.disabled = busy || !mount || (!mount.connected && !picker)
            button.title = !mount?.connected && !picker ? button.dataset.unsupported ?? "" : ""
            const label = button.querySelector("[data-folder-label]")
            if (label) label.textContent = mount?.connected ? `${button.dataset.disconnect} "${mount.handle.name}"` : button.dataset.connect ?? ""
            const authorize = button.closest(".list_drop")?.querySelector<HTMLButtonElement>("[data-folder-authorize]")
            if (authorize) { authorize.parentElement!.hidden = !mount?.connected || mount.writable; authorize.disabled = busy }
        }
    }
    const restore = async () => { try { mount = await home_directory() } catch { mount = null }; paint() }
    document.addEventListener("jazu:page", paint)
    document.addEventListener("jazu:home", () => void restore())
    void restore(); paint()
    document.addEventListener("click", event => {
        const button = (event.target as Element).closest<HTMLButtonElement>("[data-connect-folder], [data-folder-authorize]")
        if (!button || !mount || busy) return
        event.preventDefault()
        // Permission requests and the picker must start inside the click activation.
        const operation = button.hasAttribute("data-folder-authorize") ? authorize_home(mount)
            : mount.connected ? disconnect_home()
            : picker ? picker.call(window, { id: "jazu-home", mode: "readwrite" }).then(connect_home) : null
        if (!operation) return
        const status = button.closest(".list_drop")?.querySelector<HTMLElement>("[data-folder-status]")
        const message = (value: string) => { if (status) { status.hidden = !value; status.textContent = value } }
        busy = true; paint(); message("")
        void operation.then(result => {
            if (result) message(result.persistent ? button.dataset.connected ?? "" : button.dataset.session ?? "")
        }).catch(error => {
            message(error instanceof DOMException && error.name === "AbortError" ? "" : `${button.dataset.failed ?? ""}: ${error instanceof Error ? error.message : String(error)}`)
        }).finally(() => { busy = false; void restore() })
    })
}
