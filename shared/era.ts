// Japanese eras (年号). The 履歴書 writes every date as era + year (令和2年, 平成12年), so the compiler and the print script share this table.
// No imports: client_print.ts bundles it into the page script.

export type era_year = { name: string, year: number }

// [name, first Gregorian year, month, day of the first day], newest first
const eras: [string, number, number, number][] = [
    ["令和", 2019, 5, 1],
    ["平成", 1989, 1, 8],
    ["昭和", 1926, 12, 25],
    ["大正", 1912, 7, 30],
    ["明治", 1868, 1, 25],
]

// null before Meiji: the caller prints the Gregorian year instead
export function era_of(year: number, month: number, day: number): era_year | null {
    for (const [name, first_year, first_month, first_day] of eras) {
        const reached = year > first_year || (year === first_year && (month > first_month || (month === first_month && day >= first_day)))
        if (reached) return { name, year: year - first_year + 1 }
    }
    return null
}

// A date known only to the month (or the year) is placed mid-month so an era change inside that month does not decide it by accident.
export function era_of_month(year: number, month: number): era_year | null {
    return era_of(year, month || 6, 15)
}
