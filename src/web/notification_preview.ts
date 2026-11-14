import { decrypt_message, unwrap_room_key, type Work_Envelope, type Owner_Wrap } from "../work_crypto.ts"
import type { Device_Key } from "./notification_store.ts"
export type Message_Notice = { channel: string, conversation: string, id: string, sender: string, href: string }
export type Preview_Response = { email: string, owner_wrap: Owner_Wrap | null, message: { id: string, author: "owner" | "client", envelope: Work_Envelope } }
export async function preview_message(data: Message_Notice, device: Device_Key, upstream: typeof fetch = fetch): Promise<string> {
    if (data.channel !== "work" || !/^[a-f0-9-]{36}$/i.test(data.conversation) || !/^[a-f0-9-]{36}$/i.test(data.id)) throw new Error("Invalid notification")
    const response = await upstream(`/api/v1/push/message?conversation=${encodeURIComponent(data.conversation)}&id=${encodeURIComponent(data.id)}`, { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(12000) })
    if (!response.ok) throw new Error("Notification is unavailable")
    const content = await response.json() as Preview_Response
    if (content.email !== device.email || content.message.id !== data.id || (device.role === "client" && device.room !== data.conversation)) throw new Error("Notification belongs to another account")
    const key = device.role === "owner" && content.owner_wrap ? await unwrap_room_key(content.owner_wrap, device.key, data.conversation) : device.key
    return decrypt_message(key, content.message.envelope, { room: data.conversation, id: data.id, author: content.message.author })
}
