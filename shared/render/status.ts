/* Public server rendering exchanges only a template revision and an explicitly bounded snapshot. */
export type Status_Data = { revision: string; text: string; taken_at: number }
export type Status_Template = { revision: string; html: string }
export type Rendered_Status = { html: string; text: string; taken_at: number; stale: boolean }

export function status_data(value: unknown): Status_Data | null {
    if (!value || typeof value !== "object") return null
    const data = value as Record<string, unknown>
    return typeof data.revision === "string" && /^[a-f0-9]{64}$/.test(data.revision)
        && typeof data.text === "string" && data.text.length <= 8192
        && typeof data.taken_at === "number" && Number.isSafeInteger(data.taken_at) && data.taken_at >= 0 && data.taken_at <= 8.64e15
        ? { revision: data.revision, text: data.text, taken_at: data.taken_at } : null
}

export function fill_status(template: string, data: Status_Data, stale: boolean): Rendered_Status {
    const iso = new Date(data.taken_at).toISOString()
    const state = stale ? "Cached server snapshot" : "Live server snapshot"
    const values: Record<string, string> = { text: data.text, iso, state }
    const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")
    return { html: template.replace(/\{\{(text|iso|state)\}\}/g, (_, key) => escape(values[key])),
        text: `${state}\n${iso}\n\n${data.text}`, taken_at: data.taken_at, stale }
}
