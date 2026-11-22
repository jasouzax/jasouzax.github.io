export type year_month = { year: number, month: number }

export type date_span = {
    start: number
    end: number | null
    label: string
    precision: "year" | "month" | "day"
    // calendar parts of both ends (month is 1-12, or 0 when the date has only a year); the end is null for a single date
    start_ym: year_month
    end_ym: year_month | null
    // true when the end is the word "present"
    ongoing: boolean
}

const month_names = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]

type point = { value: number, precision: date_span["precision"], ym: year_month, day: number, present: boolean }

function parse_point(text: string, now: number, is_end: boolean): point | null {
    const clean = text.trim().toLowerCase()
    if (clean === "present") {
        const year = Math.floor(now)
        return { value: now, precision: "month", ym: { year, month: Math.min(12, Math.floor((now - year) * 12 + 1e-9) + 1) }, day: 0, present: true }
    }
    if (/^\d{4}$/.test(clean)) return { value: Number(clean) + (is_end ? 1 : 0), precision: "year", ym: { year: Number(clean), month: 0 }, day: 0, present: false }
    const month_year = clean.match(/^([a-z]{3})[a-z]*\.? (\d{4})$/)
    if (month_year) {
        const month = month_names.indexOf(month_year[1])
        if (month < 0) return null
        return { value: Number(month_year[2]) + month / 12, precision: "month", ym: { year: Number(month_year[2]), month: month + 1 }, day: 0, present: false }
    }
    const full = clean.match(/^([a-z]{3})[a-z]*\.? (\d{1,2}), (\d{4})$/)
    if (!full) return null
    const month = month_names.indexOf(full[1])
    if (month < 0) return null
    return { value: Number(full[3]) + (month + (Number(full[2]) - 1) / 31) / 12, precision: "day", ym: { year: Number(full[3]), month: month + 1 }, day: Number(full[2]), present: false }
}

export function year_fraction(date: Date): number {
    return date.getUTCFullYear() + date.getUTCMonth() / 12 + (date.getUTCDate() - 1) / 31 / 12
}

export function parse_date(text: string, now: number): date_span | null {
    const parts = text.split(/\s*[-\u2013]\s*(?=[A-Za-z0-9])/)
    if (parts.length > 2) return null
    const start = parse_point(parts[0], now, false)
    if (!start) return null
    if (parts.length === 1) return { start: start.value, end: null, label: text.trim(), precision: start.precision, start_ym: start.ym, end_ym: null, ongoing: false }
    const end = parse_point(parts[1], now, true)
    if (!end) return null
    return { start: start.value, end: end.value, label: `${parts[0].trim()} - ${parts[1].trim()}`, precision: start.precision, start_ym: start.ym, end_ym: end.ym, ongoing: end.present }
}

// The label shown to the reader. Dates are always written in the English form in the XML ("Aug 2022 - Jun 2026"), which is what
// parse_date reads; for any other language the same dates are formatted with Intl, so a Japanese page shows "2022年8月 – 2026年6月".
export function format_label(text: string, lang: string, present_word: string): string {
    if (lang === "en") return text.trim()
    const parts = text.split(/\s*[-\u2013]\s*(?=[A-Za-z0-9])/).map(part => part.trim())
    const shown = parts.map(part => format_point(part, lang, present_word))
    return shown.join(" \u2013 ")
}

function format_point(text: string, lang: string, present_word: string): string {
    const point = parse_point(text, 0, false)
    if (!point) return text
    if (point.present) return present_word
    const zone = { timeZone: "UTC" } as const
    if (point.precision === "year") return new Intl.DateTimeFormat(lang, { ...zone, year: "numeric" }).format(Date.UTC(point.ym.year, 0, 1))
    if (point.precision === "month") return new Intl.DateTimeFormat(lang, { ...zone, year: "numeric", month: "long" }).format(Date.UTC(point.ym.year, point.ym.month - 1, 1))
    return new Intl.DateTimeFormat(lang, { ...zone, year: "numeric", month: "long", day: "numeric" }).format(Date.UTC(point.ym.year, point.ym.month - 1, point.day))
}
