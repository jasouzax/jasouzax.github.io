/*
 * Counters that keep the public gateway inside Cloudflare's free tier: a stranger must not be able to spend the owner's daily requests.
 *
 * Entities
 *   Rate_Limit   fixed windows per key plus one budget for everybody; `take(key)` says whether one more call may pass
 *
 * Limits
 *   Lives in the memory of one Durable Object: a restart forgets the counts, which only ever makes the limit more generous for a minute.
 *   The table of keys is capped, so a flood of fake addresses cannot grow it without bound.
 */
export type Rate_Options = { per_key: number, total: number, window_ms?: number, max_keys?: number }
export type Rate_Verdict = { ok: true } | { ok: false, retry_after: number }

export class Rate_Limit {
    readonly #options: Required<Rate_Options>
    readonly #keys = new Map<string, { start: number, count: number }>()
    #total = { start: 0, count: 0 }

    constructor(options: Rate_Options) {
        this.#options = { window_ms: 60_000, max_keys: 2000, ...options }
    }

    take(key: string, now = Date.now()): Rate_Verdict {
        const { window_ms, per_key, total, max_keys } = this.#options
        if (now - this.#total.start >= window_ms) this.#total = { start: now, count: 0 }
        if (this.#total.count >= total) return { ok: false, retry_after: this.#wait(this.#total.start, now) }
        let entry = this.#keys.get(key)
        if (!entry || now - entry.start >= window_ms) {
            if (this.#keys.size >= max_keys) this.#sweep(now)
            // Still full of live keys: refuse the new one rather than evict an honest caller
            if (this.#keys.size >= max_keys) return { ok: false, retry_after: Math.ceil(window_ms / 1000) }
            entry = { start: now, count: 0 }
            this.#keys.set(key, entry)
        }
        if (entry.count >= per_key) return { ok: false, retry_after: this.#wait(entry.start, now) }
        entry.count++
        this.#total.count++
        return { ok: true }
    }

    #wait(start: number, now: number): number {
        return Math.max(1, Math.ceil((start + this.#options.window_ms - now) / 1000))
    }

    #sweep(now: number): void {
        for (const [key, entry] of this.#keys) if (now - entry.start >= this.#options.window_ms) this.#keys.delete(key)
    }
}
