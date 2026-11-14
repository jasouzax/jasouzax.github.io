/* Private Durable Object routing. Public callers never choose a principal or an internal action. */
import type { Work_Env } from "./work.ts"
export type Realtime_Namespace = { idFromName(name: string): unknown, get(id: unknown): { fetch(request: Request): Promise<Response> } }
export async function realtime_call(env: Work_Env, principal: string, action: string, data: unknown): Promise<Response> {
    if (!env.REALTIME) throw new Error("Realtime is not configured")
    return env.REALTIME.get(env.REALTIME.idFromName(principal)).fetch(new Request(`https://realtime.internal/${action}`, { method: "POST", headers: { "content-type": "application/json", "x-jazu-principal": principal }, body: JSON.stringify(data) }))
}
export async function realtime_revoke(env: Work_Env, subject: string, credential?: string): Promise<void> {
    if (env.REALTIME) try { await realtime_call(env, `a:${subject}`, "revoke", { credential }) } catch { /* Alarm validation also revokes dead sessions. */ }
}
