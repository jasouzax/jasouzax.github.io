import { init_filters, init_copy, init_chips, init_live_time, sync_theme_radios } from "./menus.ts"
import { init_scroll, init_reveal } from "./scroll.ts"
import { init_spa } from "./spa.ts"
import { init_expertise } from "./expertise.ts"
import { init_search } from "./search.ts"
import { init_sign } from "./sign.ts"
import { init_realtime } from "./realtime.ts"
import { init_connect_folder } from "./connect_folder.ts"
import { init_pager } from "./pager.ts"
import { bind_desk } from "./desk.ts"
import { init_print } from "./print.ts"
import { begin_loading, finish_loading, boot_css_ready, wait_resources } from "./loading.ts"

type theme_switch_api = {
    switch_theme(name: string, mode: string): Promise<void>
    switch_from_dom(): void
}

type theme_window = Window & { jazu_theme_switch?: theme_switch_api }

const theme_switch_url = document.currentScript?.getAttribute("data-theme-switch") ?? ""
let theme_switch_pending: Promise<theme_switch_api> | null = null

function load_theme_switch(): Promise<theme_switch_api> {
    const loaded = (window as theme_window).jazu_theme_switch
    if (loaded) return Promise.resolve(loaded)
    if (theme_switch_pending) return theme_switch_pending
    theme_switch_pending = new Promise<theme_switch_api>((done, fail) => {
        const script = document.createElement("script")
        const timer = setTimeout(() => { script.remove(); fail(new Error("theme switcher timed out")) }, 8000)
        script.src = theme_switch_url
        script.onload = () => { clearTimeout(timer); done((window as theme_window).jazu_theme_switch!) }
        script.onerror = () => { clearTimeout(timer); script.remove(); fail(new Error("theme switcher failed to load")) }
        document.head.append(script)
    }).catch(error => { theme_switch_pending = null; throw error })
    return theme_switch_pending
}

function stored_theme(): string | null {
    try {
        return localStorage.getItem("jazu_theme")
    } catch {
        return null
    }
}

init_filters()
init_copy()
init_chips()
init_live_time()
init_scroll()
init_reveal()
init_spa()
init_expertise()
init_search()
init_sign()
init_realtime()
init_connect_folder()
init_pager()
bind_desk()
init_print()
sync_theme_radios()

begin_loading("boot")
void (async () => {
    try {
        await boot_css_ready()
        const initial_css = document.getElementById("theme_css") as HTMLLinkElement | null
        if (initial_css) initial_css.media = "all"
        const theme = stored_theme()
        if (theme && theme !== document.documentElement.dataset.theme) {
            const api = await load_theme_switch()
            await api.switch_theme(theme, document.documentElement.dataset.mode ?? "auto")
        }
        sync_theme_radios()
        await wait_resources()
    } finally {
        await finish_loading("boot")
    }
})().catch(() => {})

document.addEventListener("change", event => {
    if (!(event.target as HTMLElement).matches?.(".theme_radio")) return
    void load_theme_switch().then(api => api.switch_from_dom()).catch(() => { sync_theme_radios() })
})
