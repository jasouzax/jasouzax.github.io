import { init_filters, init_copy, init_chips, init_live_time, sync_theme_radios } from "./menus.ts"
import { init_scroll, init_reveal } from "./scroll.ts"
import { init_spa } from "./spa.ts"
import { init_expertise } from "./expertise.ts"
import { init_search } from "./search.ts"
import { init_sign } from "./sign.ts"
import { init_connect_folder } from "./connect_folder.ts"
import { init_pager } from "./pager.ts"
import { bind_desk } from "./desk.ts"
import { init_print } from "./print.ts"

type theme_switch_api = {
    switch_theme(name: string, mode: string): Promise<void>
    switch_from_dom(): void
}

type theme_window = Window & { jazu_theme_switch?: theme_switch_api }

const theme_switch_url = document.currentScript?.getAttribute("data-theme-switch") ?? ""

function load_theme_switch(): Promise<theme_switch_api> {
    const loaded = (window as theme_window).jazu_theme_switch
    if (loaded) return Promise.resolve(loaded)
    return new Promise((done, fail) => {
        const script = document.createElement("script")
        script.src = theme_switch_url
        script.onload = () => done((window as theme_window).jazu_theme_switch!)
        script.onerror = () => fail(new Error("theme switcher failed to load"))
        document.head.append(script)
    })
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
init_connect_folder()
init_pager()
bind_desk()
init_print()
sync_theme_radios()

const theme = stored_theme()
if (theme && theme !== document.documentElement.dataset.theme) {
    void load_theme_switch().then(api => api.switch_theme(theme, document.documentElement.dataset.mode ?? "auto")).then(sync_theme_radios)
}

document.addEventListener("change", event => {
    if (!(event.target as HTMLElement).matches?.(".theme_radio")) return
    void load_theme_switch().then(api => api.switch_from_dom())
})
