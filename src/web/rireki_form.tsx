import { jsx, fragment, type child } from "./vnode.tsx"
import { raw } from "./markup.tsx"
import { esc_html, esc_attr } from "../util.ts"

// The 履歴書 sheets as two inline SVG pages. The layout copies, point for point, the A4 form produced by rirekisho.online (TCPDF, 595 x 842 pt):
// every line, box and text anchor below is a coordinate taken from that PDF, so one SVG user unit is one PDF point and the print stylesheet only has
// to scale the viewBox to the sheet. SVG text is placed by its baseline, which makes the result independent of the font that ends up drawing it.
// This file is pure (strings in, strings out) so html_rirekisho.tsx can feed it the page's data and a test can feed it anything.

export type form_row = {
    year: string
    month: string
    text: string
    kind: "line" | "heading" | "right" | "blank"
}
export type form_date = { era: string; year: string; month: string; day: string }

export type form_input = {
    t: (key: string) => string
    // the "as of" date at the top right; client_print.ts replaces it with the day of printing
    as_of: form_date
    kana: string
    name: string
    birth: form_date | null
    gender: string
    address_kana: string
    postal: string
    address: string
    email: string
    phone: string
    mobile: string
    contact_kana: string
    contact_postal: string
    contact_address: string
    contact_phone: string
    photo: string
    history: form_row[]
    licences: form_row[]
    motivation: string[]
    wishes: string[]
    commute_hours: string
    commute_minutes: string
    dependents: string
    spouse: string
    spouse_support: string
    warn: (message: string) => void
}

// ---- measuring and wrapping -------------------------------------------------------------------------------------------------------------

// The form (TCPDF with the half-width Latin of its Mincho font) advances Latin letters, digits and spaces half an em and everything else one em.
// "Half" characters: ASCII graphic characters, accented Latin and half-width katakana. The same model places the text, so what is measured is what is drawn.
function is_half(code: number): boolean {
    return (
        (code >= 0x21 && code <= 0x7e) ||
        (code >= 0xa1 && code <= 0x24f) ||
        (code >= 0xff61 && code <= 0xff9f)
    )
}

export function text_width(text: string, size: number): number {
    let width = 0
    for (const char of text) {
        const code = char.codePointAt(0)!
        width += code === 0x20 || is_half(code) ? 0.5 : 1
    }
    return width * size
}

function fit_size(text: string, size: number, max_width: number, minimum: number = 5): number {
    const width = text_width(text, size)
    if (width <= max_width) return size
    return Math.max(minimum, Math.floor(((size * max_width) / width) * 4) / 4)
}

const no_start = new Set([
    ..."、。，．・：；？！）」』】〕〉》｝ゝゞー々ぁぃぅぇぉっゃゅょァィゥェォッャュョ"
])
const no_end = new Set([..."（「『【〔〈《｛"])

// Greedy line breaking: ASCII words stay whole, Japanese breaks between any two characters except before 、。）」 and after （「.
export function wrap(text: string, size: number, width: number): string[] {
    const lines: string[] = []
    for (const paragraph of text.split(/\r?\n/)) {
        const tokens = paragraph.match(/[\x21-\x7e]+|\s|[^\x00-\x7f]/gu) ?? []
        let line: string[] = []
        let used = 0
        const flush = (): void => {
            const text_line = line.join("").replace(/\s+$/u, "")
            if (text_line !== "") lines.push(text_line)
            line = []
            used = 0
        }
        for (const token of tokens) {
            const is_space = /^\s$/u.test(token)
            if (is_space && line.length === 0) continue
            const token_width = text_width(token, size)
            if (used + token_width <= width + 0.01 || is_space) {
                line.push(token)
                used += token_width
                continue
            }
            // a closing mark may hang one character past the edge rather than start the next line
            if (no_start.has(token) && used + token_width <= width + size) {
                line.push(token)
                used += token_width
                continue
            }
            const carry = line.length > 0 && no_end.has(line[line.length - 1]) ? line.pop() : undefined
            flush()
            if (carry) {
                line.push(carry)
                used = text_width(carry, size)
            }
            if (token_width <= width) {
                line.push(token)
                used += token_width
            } else {
                // a single ASCII word wider than the box: split it by characters
                for (const char of token) {
                    const char_width = text_width(char, size)
                    if (used + char_width > width) flush()
                    line.push(char)
                    used += char_width
                }
            }
        }
        flush()
    }
    return lines
}

// Largest size (8 pt, as in the form, down to 5 pt) at which the paragraphs fit between the first baseline and the last allowed baseline.
function fit_block(
    paragraphs: string[],
    width: number,
    first: number,
    last: number,
    warn: (message: string) => void,
    name: string
): { size: number; pitch: number; lines: string[] } {
    const body = paragraphs
        .map((paragraph) => paragraph.trim())
        .filter((paragraph) => paragraph !== "")
        .join("\n")
    for (let size = 8; size >= 5; size -= 0.25) {
        const pitch = size * 1.625
        const lines = wrap(body, size, width)
        if (first + (lines.length - 1) * pitch <= last) return { size, pitch, lines }
    }
    const size = 5
    const pitch = size * 1.625
    const lines = wrap(body, size, width)
    const room = Math.floor((last - first) / pitch) + 1
    warn(`${name} does not fit its box even at ${size} pt, the last ${lines.length - room} line(s) are cut`)
    return { size, pitch, lines: lines.slice(0, room) }
}

// ---- drawing ------------------------------------------------------------------------------------------------------------------------------

function num(value: number): string {
    return String(Math.round(value * 100) / 100)
}

type text_options = {
    anchor?: "start" | "middle" | "end"
    xs?: number[]
    attrs?: import("./vnode.tsx").attributes
    plain?: boolean
}

// A line of text split into runs: Latin words (half-width) and Japanese stretches, each with its own start x.
// Words are squeezed to exactly half an em per character (textLength), which is how the form sets them, so a word starts and ends where it does in
// the PDF whatever Latin glyphs the print font has. `plain` skips that (text a script rewrites at print time keeps its natural width).
function runs_of(body: string, x: number, size: number): { x: number; text: string; half: boolean }[] {
    const runs: { x: number; text: string; half: boolean }[] = []
    let at = x
    let current: { x: number; text: string; half: boolean } | null = null
    for (const char of body) {
        const code = char.codePointAt(0)!
        if (code === 0x20) {
            current = null
            at += size * 0.5
            continue
        }
        const half = is_half(code)
        if (!current || current.half !== half) {
            current = { x: at, text: "", half }
            runs.push(current)
        }
        current.text += char
        at += size * (half ? 0.5 : 1)
    }
    return runs
}

function text(x: number, y: number, size: number, body: string, options: text_options = {}): child {
    if (body === "") return ""
    const attrs = options.attrs ?? {}
    if (options.xs)
        return (
            <>
                <text x={options.xs.map(num).join(" ")} y={num(y)} font-size={num(size)} {...attrs}>
                    {body}
                </text>
            </>
        )
    const width = text_width(body, size)
    const start = options.anchor === "middle" ? x - width / 2 : options.anchor === "end" ? x - width : x
    if (options.plain)
        return (
            <>
                <text x={num(start)} y={num(y)} font-size={num(size)} {...attrs}>
                    {body}
                </text>
            </>
        )
    const runs = runs_of(body, start, size)
    if (runs.length === 1 && !runs[0].half)
        return (
            <>
                <text x={num(runs[0].x)} y={num(y)} font-size={num(size)} {...attrs}>
                    {body.trim()}
                </text>
            </>
        )
    const spans = runs.map((run) => {
        const fixed = run.half
            ? { textLength: num([...run.text].length * size * 0.5), lengthAdjust: "spacingAndGlyphs" }
            : {}
        return (
            <>
                <tspan x={num(run.x)} {...fixed}>
                    {run.text}
                </tspan>
            </>
        )
    })
    return (
        <>
            <text y={num(y)} font-size={num(size)} {...attrs}>
                {spans}
            </text>
        </>
    )
}

// A label whose characters sit one per 12 pt cell, the way the form spaces 現住所, 連絡先 and 氏名.
function spaced(x: number, y: number, size: number, label: string): child {
    const chars = [...label.replace(/\s+/gu, "")]
    return text(x, y, size, chars.join(""), { xs: chars.map((_, index) => x + index * 12) })
}

// A value on one line: shrunk (never below 5 pt) when it would run past `limit`.
function value(x: number, y: number, size: number, body: string, limit: number): child {
    return text(x, y, fit_size(body, size, limit - x), body)
}

type shapes = { solid: string[]; dashed: string[]; boxes: [number, number, number, number][] }

function hline(shape: string[], x0: number, x1: number, y: number): void {
    shape.push(`M${num(x0)} ${num(y)}H${num(x1)}`)
}

function vline(shape: string[], x: number, y0: number, y1: number): void {
    shape.push(`M${num(x)} ${num(y0)}V${num(y1)}`)
}

function frame(parts: shapes): child {
    const boxes = parts.boxes.map(([x, y, width, height]) => (
        <>
            <rect
                class={"rf_box"}
                x={num(x)}
                y={num(y)}
                width={num(width)}
                height={num(height)}
                fill={"none"}
                stroke={"#000"}
                stroke-width={"1.5"}
            ></rect>
        </>
    ))
    const solid = (
        <>
            <path
                class={"rf_line"}
                d={parts.solid.join("")}
                fill={"none"}
                stroke={"#000"}
                stroke-width={"1"}
            ></path>
        </>
    )
    const dashed = (
        <>
            <path
                class={"rf_dash"}
                d={parts.dashed.join("")}
                fill={"none"}
                stroke={"#000"}
                stroke-width={"1"}
                stroke-dasharray={"3 3"}
            ></path>
        </>
    )
    return [boxes, solid, dashed]
}

function svg(label: string, body: child[]): child {
    return (
        <>
            <svg
                class={"rireki_svg"}
                xmlns={"http://www.w3.org/2000/svg"}
                viewBox={"0 0 595 842"}
                preserveAspectRatio={"xMinYMin meet"}
                role={"img"}
                aria-label={label}
            >
                {body.filter((part) => part !== "")}
            </svg>
        </>
    )
}

// ---- table rows ---------------------------------------------------------------------------------------------------------------------------

const year_x = 60
const month_x = 125
const text_x = 157
const text_limit = 533
const heading_x = 344
const right_x = 531

function table_text(
    tops: number[],
    offset: number,
    rows: form_row[],
    warn: (message: string) => void,
    name: string
): child {
    const out: child[] = []
    if (rows.length > tops.length)
        warn(`${name}: ${rows.length - tops.length} row(s) do not fit the form and are left out`)
    rows.slice(0, tops.length).forEach((row, index) => {
        const y = tops[index] + offset
        if (row.kind === "blank") return
        out.push(text(year_x, y, 12, row.year), text(month_x, y, 12, row.month))
        if (row.kind === "heading")
            out.push(
                text(heading_x, y, 12, [...row.text.replace(/\s+/gu, "")].join("　"), { anchor: "middle" })
            )
        else if (row.kind === "right")
            out.push(text(right_x, y, fit_size(row.text, 12, 300, 7), row.text, { anchor: "end" }))
        else out.push(value(text_x, y, 12, row.text, text_limit))
    })
    return out
}

function header_text(t: (key: string) => string, y: number, title: string, title_x: number): child {
    return [text(76, y, 8, t("rireki_year")), text(125, y, 8, t("rireki_month")), text(title_x, y, 8, title)]
}

function column_tops(first: number, count: number, step: number = 27): number[] {
    return Array.from({ length: count }, (_, index) => first + index * step)
}

// ---- the photo box ------------------------------------------------------------------------------------------------------------------------

// 75 x 100 pt at (450, 53): the author's photo, or the form's own instructions in a dotted frame.
function photo_box(f: form_input): child {
    if (f.photo)
        return (
            <>
                <image
                    class={"rf_photo"}
                    href={f.photo}
                    x={"450"}
                    y={"53"}
                    width={"75"}
                    height={"100"}
                    preserveAspectRatio={"xMidYMin slice"}
                />
            </>
        )
    const frame_box = (
        <>
            <rect
                class={"rf_dots"}
                x={"452.4"}
                y={"55.4"}
                width={"70.2"}
                height={"95.2"}
                fill={"none"}
                stroke={"#000"}
                stroke-width={"1.4"}
                stroke-dasharray={"0.8 1.1"}
            ></rect>
        </>
    )
    const baselines = [73.2, 82.1, 91.4, 102.3, 111.6, 120.7, 133]
    const lines = baselines.map((y, index) => text(457, y, 6.7, f.t(`rireki_photo_${index + 1}`)))
    return [frame_box, lines]
}

// ---- page 1: personal details and the first 17 rows of the history -------------------------------------------------------------

export const first_page_rows = 17
export const history_page_rows = 7
export const licence_rows = 7

function page_one(f: form_input): child {
    const t = f.t
    const shape: shapes = {
        solid: [],
        dashed: [],
        boxes: [
            [47, 61, 379, 102],
            [47, 163, 491, 71.03],
            [47, 234.01, 491, 53],
            [47, 295, 491, 476]
        ]
    }
    // personal box
    hline(shape.solid, 47, 426, 127)
    vline(shape.solid, 361, 127, 163)
    hline(shape.dashed, 47, 426, 84)
    // address and contact boxes
    vline(shape.solid, 450, 163, 287)
    for (const y of [180, 216, 251]) hline(shape.dashed, 47, 449, y)
    for (const y of [180, 198, 216, 251]) hline(shape.dashed, 450, 538, y)
    // history table
    vline(shape.solid, 150, 295, 771)
    vline(shape.dashed, 111, 295, 771)
    for (let y = 312; y <= 744; y += 27) hline(shape.solid, 47, 538, y)

    const parts: child[] = [frame(shape), photo_box(f)]
    const out = (...items: child[]): void => {
        parts.push(...items.filter((item) => item !== ""))
    }

    // title and the "as of" date, right aligned to the personal box
    const live = (part: string) => ({ "data-print_part": part })
    out(text(47, 53, 18, t("rireki_title")))
    out(
        text(322, 55, 8, f.as_of.era, { attrs: live("era"), plain: true }),
        text(342, 55, 8, f.as_of.year, { attrs: live("year"), plain: true }),
        text(354, 55, 8, t("rireki_year"))
    )
    out(
        text(367, 55, 8, f.as_of.month, { attrs: live("month"), plain: true }),
        text(378, 55, 8, t("rireki_month"))
    )
    out(
        text(392, 55, 8, f.as_of.day, { attrs: live("day"), plain: true }),
        text(402, 55, 8, `${t("rireki_day")}${t("rireki_asof")}`)
    )

    // reading, name
    out(text(51, 76, 8, t("rireki_kana")), value(89, 76, 8, f.kana, 422))
    out(spaced(55, 96, 8, t("rireki_name")), text(95, 114, fit_size(f.name, 20, 326, 10), f.name))

    // birth date (era, year, month, day) and gender
    out(
        text(52, 147, 8, f.birth?.era ?? ""),
        text(72, 147, 8, f.birth?.year ?? ""),
        text(84, 147, 8, t("rireki_year"))
    )
    out(text(96, 147, 8, f.birth?.month ?? ""), text(108, 147, 8, t("rireki_month")))
    out(text(120, 147, 8, f.birth?.day ?? ""), text(132, 147, 8, `${t("rireki_day")}${t("rireki_born")}`))
    out(text(391, 147, 8, f.gender, { anchor: "middle" }))

    // current address
    out(text(51, 174, 8, t("rireki_kana")), value(92, 174, 8, f.address_kana, 445))
    out(
        spaced(51, 191, 8, t("rireki_address")),
        text(87, 191, 8, t("rireki_postal")),
        text(95, 191, 8, f.postal)
    )
    out(value(87, 206, 8, f.address, 445))
    out(text(51, 228, 8, t("rireki_email")), value(87, 228, 8, f.email, 445))
    out(text(453, 174, 8, t("rireki_phone_home")), value(453, 192, 8, f.phone, 535))
    out(text(453, 210, 8, t("rireki_phone_mobile")), value(453, 228, 8, f.mobile, 535))

    // contact address (only when it differs from the current one)
    out(text(51, 246, 8, t("rireki_kana")), value(92, 246, 8, f.contact_kana, 445))
    out(
        spaced(51, 261, 8, t("rireki_contact")),
        text(87, 261, 8, t("rireki_postal")),
        text(95, 261, 8, f.contact_postal)
    )
    const note_x = Math.max(131, 95 + text_width(f.contact_postal, 8) + 4)
    out(text(note_x, 261, 8, t("rireki_contact_note")))
    out(value(87, 276, 8, f.contact_address, 445))
    out(text(453, 246, 8, t("rireki_phone_contact")), value(453, 262, 8, f.contact_phone, 535))

    // history table
    out(header_text(t, 307, t("rireki_history"), 287))
    out(
        table_text(
            column_tops(312, first_page_rows),
            18,
            f.history.slice(0, first_page_rows),
            f.warn,
            t("rireki_history")
        )
    )
    return svg(t("rireki_title"), parts)
}

// ---- page 2: the rest of the history, licences, motivation, commute and family, wishes ------------------------------------------

function page_two(f: form_input): child {
    const t = f.t
    const shape: shapes = {
        solid: [],
        dashed: [],
        boxes: [
            [47, 61, 491, 206],
            [47, 267, 491, 207],
            [47, 482, 491, 98],
            [361, 482, 177, 33],
            [361, 515, 177, 33],
            [361, 548, 73, 32],
            [47, 588, 491, 168]
        ]
    }
    vline(shape.solid, 150, 61, 474)
    vline(shape.dashed, 111, 61, 474)
    for (const y of [77, 104, 131, 158, 185, 212, 239, 285, 312, 339, 366, 393, 420, 447, 605])
        hline(shape.solid, 47, 538, y)

    const parts: child[] = [frame(shape)]
    const out = (...items: child[]): void => {
        parts.push(...items.filter((item) => item !== ""))
    }

    // history, continued
    out(header_text(t, 72, t("rireki_history"), 287))
    out(
        table_text(
            column_tops(77, history_page_rows),
            19,
            f.history.slice(first_page_rows),
            f.warn,
            t("rireki_history")
        )
    )

    // licences and qualifications
    out(header_text(t, 279, t("rireki_licenses"), 312))
    out(table_text(column_tops(285, licence_rows), 19, f.licences, f.warn, t("rireki_licenses")))

    // motivation, special skills, favourite subjects (left of the commute column)
    out(text(51, 493, 8, t("rireki_motivation")))
    const motivation = fit_block(f.motivation, 300, 506, 577, f.warn, t("rireki_motivation"))
    motivation.lines.forEach((line, index) =>
        out(text(51, 506 + index * motivation.pitch, motivation.size, line))
    )

    // commute time, dependants, spouse
    out(text(365, 493, 8, t("rireki_commute")))
    out(
        text(474, 509, 8, t("rireki_about")),
        text(483, 509, 8, f.commute_hours),
        text(494, 509, 8, t("rireki_hours")),
        text(512, 509, 8, f.commute_minutes),
        text(522, 509, 8, t("rireki_minutes"))
    )
    out(text(365, 526, 8, t("rireki_dependents")))
    out(text(515, 541, 8, f.dependents), text(525, 541, 8, t("rireki_people")))
    out(text(365, 559, 8, t("rireki_spouse")), text(437, 559, 8, t("rireki_spouse_support")))
    out(
        text(397.5, 574, 8, f.spouse, { anchor: "middle" }),
        text(486, 574, 8, f.spouse_support, { anchor: "middle" })
    )

    // wishes
    out(text(51, 600, 8, t("rireki_wishes")))
    const wishes = fit_block(f.wishes, 483, 616, 753, f.warn, t("rireki_wishes"))
    wishes.lines.forEach((line, index) => out(text(51, 616 + index * wishes.pitch, wishes.size, line)))
    return svg(t("rireki_title"), parts)
}

export function render_form(f: form_input): child[] {
    return [page_one(f), page_two(f)]
}
