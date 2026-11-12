// A printed resume carries the day it was printed, not the day the site was built.
// The page ships the build date as a fallback; the browser fires beforeprint just before it lays the page out for the printer.
// The 履歴書 writes the date as era + year + month + day (令和8年10月31日), one <text> per part, marked data-print_part="era|year|month|day".
import { era_of } from "../../era.ts"
import { init_rireki_editor } from "./rireki_editor.ts"

function fill_print_fields(): void {
    const now = new Date()
    const year = now.getFullYear()
    const month = now.getMonth() + 1
    const day = now.getDate()
    const era = era_of(year, month, day)
    const parts: Record<string, string> = { era: era?.name ?? "", year: String(era?.year ?? year), month: String(month), day: String(day) }
    for (const node of document.querySelectorAll<SVGTextElement>("[data-print_part]")) {
        node.textContent = parts[node.dataset.print_part ?? ""] ?? node.textContent
    }
}

export function init_print(): void {
    init_rireki_editor()
    document.addEventListener("jazu:page", init_rireki_editor)
    addEventListener("beforeprint", () => {
        document.documentElement.setAttribute("data-rireki-printing", "")
        fill_print_fields()
    })
    addEventListener("afterprint", () => document.documentElement.removeAttribute("data-rireki-printing"))
}
