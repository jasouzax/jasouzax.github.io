/* A persistent local document can finish its transaction before a same-document page swap. */
const guards = new Set<() => Promise<boolean>>()
export function register_navigation_guard(guard: () => Promise<boolean>, signal: AbortSignal): void {
    if (signal.aborted) return
    guards.add(guard); signal.addEventListener("abort", () => guards.delete(guard), { once: true })
}
export async function prepare_navigation(): Promise<boolean> {
    for (const guard of guards) { try { if (!await guard()) return false } catch { return false } }
    return true
}
