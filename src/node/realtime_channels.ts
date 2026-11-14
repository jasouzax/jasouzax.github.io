/* Channel registry: adding another conversation type does not change the socket/presence engine. */
import type { Work_Env } from "./work.ts"
import type { Realtime_Actor } from "./realtime_work.ts"
import { work_channel } from "./realtime_work.ts"
export type Realtime_Channel = {
    authorize(env: Work_Env, actor: Realtime_Actor, conversation: string, origin: string): Promise<{ target: string | null }>
    history(env: Work_Env, conversation: string, after: number): Promise<any[]>
    send(env: Work_Env, actor: Realtime_Actor, origin: string, data: any, dispatch: () => Promise<void>): Promise<{ value?: unknown, error?: string }>
    notification(env: Work_Env, principal: string, data: any): Promise<any | null>
    changed(env: Work_Env, principal: string, data: any): Promise<any | null>
}
export const realtime_channels = new Map<string, Realtime_Channel>([["work", work_channel]])
