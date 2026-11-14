/* Relative presence text is computed locally; updating the clock makes no network request. */
export function relative_presence(timestamp: number, language: string, now = Date.now()): string | null {
    const minutes = Math.max(0, Math.floor((now - timestamp) / 60000))
    if (!minutes) return null
    const [value, unit] = minutes >= 1440 ? [Math.floor(minutes / 1440), "day"] as const : minutes >= 60 ? [Math.floor(minutes / 60), "hour"] as const : [minutes, "minute"] as const
    return new Intl.RelativeTimeFormat(language || "en", { numeric: "always" }).format(-value, unit)
}
