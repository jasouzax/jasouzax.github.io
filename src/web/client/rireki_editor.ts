import { render_form, first_page_rows, history_page_rows, licence_rows, type form_input } from "../rireki_form.tsx"
import { to_dom } from "../vnode.tsx"

// Editors are overlays; only the SVG underneath is sent to the printer.
export function init_rireki_editor(): void {
    for (const root of document.querySelectorAll<HTMLElement>(".rireki[data-rireki]")) {
        if (root.dataset.editor_ready) continue
        root.dataset.editor_ready = "true"
        const saved = JSON.parse(root.dataset.rireki!)
        const input: form_input = { ...saved, t: (key) => saved.labels[key] ?? key, warn: () => {} }
        // No storage or network requests: private additions live only in this document.
        root.removeAttribute("data-rireki")
        const sheets = [...root.querySelectorAll<HTMLElement>(".rireki_sheet")]
        const redraw = () => render_form(input).forEach((sheet, index) => {
            sheets[index].querySelector("svg")!.replaceWith(to_dom(sheet))
        })
        const field = (page: number, label: string, box: number[], get: () => string, set: (value: string) => void, multiline = false) => {
            const control = document.createElement(multiline ? "textarea" : "input")
            control.className = "rireki_editor"
            control.setAttribute("aria-label", label)
            control.setAttribute("autocomplete", "off")
            control.setAttribute("spellcheck", "false")
            control.value = get()
            const [x, y, width, height] = box
            control.style.cssText = `left:${x / 595 * 100}%;top:${y / 842 * 100}%;width:${width / 595 * 100}%;height:${height / 842 * 100}%`
            control.addEventListener("input", () => { set(control.value); redraw() })
            sheets[page].append(control)
        }
        const personal: [keyof form_input, string, number[]][] = [
            ["kana", "ふりがな", [89, 62, 333, 21]], ["name", "氏名", [95, 85, 326, 41]],
            ["gender", "性別", [362, 128, 63, 34]],
            ["address_kana", "現住所ふりがな", [92, 164, 353, 15]],
            ["postal", "郵便番号", [95, 181, 90, 17]], ["address", "現住所", [87, 199, 358, 17]],
            ["email", "メール", [87, 217, 358, 16]], ["phone", "電話", [453, 181, 82, 17]],
            ["mobile", "携帯電話", [453, 217, 82, 16]],
            ["contact_kana", "連絡先ふりがな", [92, 235, 353, 15]],
            ["contact_postal", "連絡先郵便番号", [95, 252, 35, 16]],
            ["contact_address", "連絡先住所", [87, 268, 358, 18]], ["contact_phone", "連絡先電話", [453, 252, 82, 34]],
        ]
        for (const [key, label, box] of personal) field(0, label, box, () => String(input[key] ?? ""), value => { Object.assign(input, { [key]: value }) })
        for (const [part, x, width] of [["era", 52, 20], ["year", 72, 12], ["month", 96, 12], ["day", 120, 12]] as const) {
            field(0, `生年月日 ${part}`, [x, 134, width, 22], () => input.birth?.[part] ?? "", value => {
                input.birth ??= { era: "", year: "", month: "", day: "" }
                input.birth[part] = value
            })
        }
        for (const [key, label, box] of [
            ["commute_hours", "通勤時間（時間）", [481, 497, 13, 17]],
            ["commute_minutes", "通勤時間（分）", [509, 497, 13, 17]],
            ["dependents", "扶養家族数", [500, 530, 25, 17]],
            ["spouse", "配偶者", [362, 562, 71, 17]],
            ["spouse_support", "配偶者の扶養義務", [435, 562, 102, 17]],
        ] as [keyof form_input, string, number[]][]) field(1, label, box, () => String(input[key] ?? ""), value => { Object.assign(input, { [key]: value }) })
        for (const key of ["motivation", "wishes"] as const) field(1, key === "motivation" ? "志望動機・特技" : "本人希望", key === "motivation" ? [51, 496, 300, 83] : [51, 606, 483, 148], () => input[key].filter(Boolean).join("\n"), value => { input[key] = [value] }, true)
        for (const [page, key, start, count, offset] of [
            [0, "history", 312, first_page_rows, 0],
            [1, "history", 77, history_page_rows, first_page_rows],
            [1, "licences", 285, licence_rows, 0],
        ] as const) {
            for (let index = 0; index < count; index++) {
                const at = index + offset
                const rows = input[key]
                while (rows.length <= at) rows.push({ year: "", month: "", text: "", kind: "line" })
                for (const [part, x, width] of [["year", 49, 61], ["month", 112, 37], ["text", 153, 383]] as const) {
                    field(page, `${key} ${at + 1} ${part}`, [x, start + index * 27 + 1, width, 25], () => rows[at][part], value => {
                        rows[at][part] = value
                        if (rows[at].kind === "blank") rows[at].kind = "line"
                    })
                }
            }
        }
        const photo = document.createElement("input")
        photo.type = "file"
        photo.accept = "image/png,image/jpeg,image/webp"
        photo.className = "rireki_editor rireki_photo_editor"
        photo.setAttribute("aria-label", "証明写真を選択")
        photo.style.cssText = `left:${450 / 595 * 100}%;top:${53 / 842 * 100}%;width:${75 / 595 * 100}%;height:${100 / 842 * 100}%`
        photo.addEventListener("change", async () => {
            const file = photo.files?.[0]
            if (!file || !["image/png", "image/jpeg", "image/webp"].includes(file.type)) return
            const reader = new FileReader()
            reader.addEventListener("load", () => { input.photo = String(reader.result); redraw() })
            reader.readAsDataURL(file)
        })
        sheets[0].append(photo)
    }
}
