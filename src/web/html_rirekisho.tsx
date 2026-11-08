import { published_resource } from "../resources.ts"
import { jsx, fragment, type child } from "./vnode.tsx"
import { raw } from "./markup.tsx"
import type { xml_node } from "../xml.ts"
import { child_nodes, where_of } from "../xml.ts"
import type { html } from "../util.ts"
import type { render_ctx } from "./html_common.tsx"
import { section_of, ui_text } from "../model.ts"
import type { expertise_model, bar } from "../expertise.ts"
import { parse_date } from "../dates.ts"
import { era_of, era_of_month } from "../era.ts"
import { render_form } from "./rireki_form.tsx"
import type { form_date, form_row } from "./rireki_form.tsx"
import { select_print, print_person } from "../prints.ts"
import { report_error, report_warning } from "../diag.ts"

// A printed resume in the Japanese form: 履歴書 (rirekisho). A page opts in with <resume format="rirekisho" ...>; the personal details live on
// that element and the education / work history come from the same <event resume="education|experience"> entries the international resume
// uses, so the two never drift apart. Like the international resume this markup is hidden on screen and only the page's print stylesheet
// shows it. The sheets copy the A4 form of rirekisho.online (see rireki_form.tsx): page 1 holds the personal details, the photo and the first 17
// history rows; page 2 the rest of the history, the licences / qualifications, the motivation box, commute and family boxes and the wishes box.
// Details the author did not give print as empty boxes to write in, they are never made up.

export type resume_format = "international" | "rirekisho"

const formats: resume_format[] = ["international", "rirekisho"]

export function resume_format_of(ctx: render_ctx): { format: resume_format; node: xml_node | undefined } {
    const mode = select_print(ctx.model, ctx.page)
    const node = mode ? print_person(ctx.model, ctx.page) : undefined
    const format =
        mode?.attrs.layout === "rirekisho" || mode?.attrs.name === "rirekisho" ? "rirekisho" : "international"
    return { format, node }
}

function field(value: string | undefined): string {
    return (value ?? "").trim()
}

function parse_birth(text: string | undefined): { year: number; month: number; day: number } | null {
    const match = (text ?? "").trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
    return match ? { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) } : null
}

function two(value: number): string {
    return String(value).padStart(2, "0")
}

// 令和2 / 平成12: the era and its year; a date before Meiji falls back to the Gregorian year.
function era_year_text(year: number, month: number): string {
    const era = era_of_month(year, month)
    return era ? `${era.name}${era.year}` : String(year)
}

// The "as of" date at the top of the sheet: the build date here, the day of printing once client_print.ts runs. The day and month are not padded.
function as_of_date(ctx: render_ctx): form_date {
    const date = ctx.model.build_date
    const year = date.getUTCFullYear()
    const month = date.getUTCMonth() + 1
    const day = date.getUTCDate()
    const era = era_of(year, month, day)
    return { era: era?.name ?? "", year: String(era?.year ?? year), month: String(month), day: String(day) }
}

// The birth date: era, year, then month and day written with two digits as the form prints them.
function birth_date(resume: xml_node): form_date | null {
    const birth = parse_birth(resume.attrs.birth)
    if (!birth) return null
    const era = era_of(birth.year, birth.month, birth.day)
    return {
        era: era?.name ?? "",
        year: String(era?.year ?? birth.year),
        month: two(birth.month),
        day: two(birth.day)
    }
}

type history_line = { at: number; year: number; month: number; text: string }

function month_index(year: number, month: number): number {
    return year * 12 + (month || 1)
}

function bar_lines(ctx: render_ctx, bars: bar[], enter_key: string, leave_key: string): history_line[] {
    const default_text = (bar: bar, key: string): string =>
        `${bar.name}${bar.sub ? `（${bar.sub}）` : ""} ${ui_text(ctx.model, ctx.lang, key)}`
    const lines: history_line[] = []
    for (const bar of bars) {
        lines.push({
            at: month_index(bar.start_ym.year, bar.start_ym.month),
            year: bar.start_ym.year,
            month: bar.start_ym.month,
            text: bar.resume_start || default_text(bar, enter_key)
        })
        if (bar.ongoing) continue
        lines.push({
            at: month_index(bar.end_ym.year, bar.end_ym.month),
            year: bar.end_ym.year,
            month: bar.end_ym.month,
            text: bar.resume_end || default_text(bar, leave_key)
        })
    }
    // oldest first; two lines in the same month keep the order they were written in
    return lines
        .map((line, index) => ({ line, index }))
        .sort((a, b) => a.line.at - b.line.at || a.index - b.index)
        .map((item) => item.line)
}

function history_rows_of(ctx: render_ctx, data: expertise_model): form_row[] {
    const rows: form_row[] = []
    const heading = (key: string): form_row => ({
        year: "",
        month: "",
        text: ui_text(ctx.model, ctx.lang, key),
        kind: "heading"
    })
    const plain = (key: string, kind: "line" | "right"): form_row => ({
        year: "",
        month: "",
        text: ui_text(ctx.model, ctx.lang, key),
        kind
    })
    const as_rows = (lines: history_line[]): form_row[] =>
        lines.map((line) => ({
            year: line.year ? era_year_text(line.year, line.month) : "",
            month: line.month ? two(line.month) : "",
            text: line.text,
            kind: "line" as const
        }))
    const education = data.bars.filter((bar) => bar.resume === "education")
    const experience = data.bars.filter((bar) => bar.resume === "experience")
    rows.push(heading("rireki_education"))
    rows.push(...as_rows(bar_lines(ctx, education, "rireki_enter", "rireki_graduate")))
    rows.push(heading("rireki_work"))
    if (experience.length === 0) rows.push(plain("rireki_none", "line"))
    else rows.push(...as_rows(bar_lines(ctx, experience, "rireki_started", "rireki_finished")))
    if (experience.some((bar) => bar.ongoing)) rows.push(plain("rireki_current", "right"))
    rows.push(plain("rireki_end", "right"))
    return rows
}

function licence_rows_of(ctx: render_ctx, resume: xml_node): form_row[] {
    return child_nodes(resume, "license").map((item) => {
        const span = item.attrs.date ? parse_date(item.attrs.date, ctx.model.now) : null
        if (item.attrs.date && !span)
            report_error(ctx.model.diag, where_of(item), `invalid date "${item.attrs.date}"`)
        const year = span ? span.start_ym.year : 0
        const month = span ? span.start_ym.month : 0
        return {
            year: year ? era_year_text(year, month) : "",
            month: month ? two(month) : "",
            text: item.attrs.text,
            kind: "line" as const
        }
    })
}

// <resume spouse="true|false"> prints 有り / 無し; left out it prints nothing.
function yes_no(ctx: render_ctx, value: string | undefined): string {
    if (value === "true") return ui_text(ctx.model, ctx.lang, "rireki_yes")
    if (value === "false") return ui_text(ctx.model, ctx.lang, "rireki_no")
    return ""
}

// The photo is printed when its file exists; otherwise the form's own "put a photo here" box is drawn.
function photo_url(ctx: render_ctx, resume: xml_node): string {
    const source = field(resume.attrs.photo)
    if (!source) return ""
    if (!/^(?:https?:)?\/\//.test(source) && !published_resource(ctx.model, source)) return ""
    return source
}

// Print only, in the expertise article: the two sheets of the form. (The landing article prints nothing for a rirekisho.)
export function render_rirekisho_body(ctx: render_ctx, data: expertise_model, resume: xml_node): html {
    const landing = section_of(ctx.page, "hero")
    const full_name =
        resume.attrs.name ?? [landing?.attrs.name, landing?.attrs.family].filter(Boolean).join(" ")
    const sheets = render_form({
        t: (key) => ui_text(ctx.model, ctx.lang, key),
        as_of: as_of_date(ctx),
        kana: field(resume.attrs.kana),
        name: field(full_name),
        birth: birth_date(resume),
        gender: field(resume.attrs.gender),
        address_kana: field(resume.attrs.address_kana),
        postal: field(resume.attrs.postal),
        address: field(resume.attrs.address),
        email: field(resume.attrs.email),
        phone: field(resume.attrs.phone),
        mobile: field(resume.attrs.mobile),
        contact_kana: field(resume.attrs.contact_kana),
        contact_postal: field(resume.attrs.contact_postal),
        contact_address: field(resume.attrs.contact_address),
        contact_phone: field(resume.attrs.contact_phone),
        photo: photo_url(ctx, resume),
        history: history_rows_of(ctx, data),
        licences: licence_rows_of(ctx, resume),
        motivation: [resume.attrs.motivation ?? "", resume.attrs.appeal ?? ""],
        wishes: [resume.attrs.wishes ?? ""],
        commute_hours: field(resume.attrs.commute_hours),
        commute_minutes: field(resume.attrs.commute_minutes),
        dependents: field(resume.attrs.dependents),
        spouse: yes_no(ctx, resume.attrs.spouse),
        spouse_support: yes_no(ctx, resume.attrs.spouse_support),
        warn: (message) => report_warning(ctx.model.diag, where_of(resume), message)
    })
    const pages = sheets.map((sheet) => (
        <>
            <div class={"rireki_sheet"}>{sheet}</div>
        </>
    ))
    return (
        <>
            <div class={"expertise_resume rireki"} hidden={""} data-format={"rirekisho"}>
                {pages}
            </div>
        </>
    )
}
