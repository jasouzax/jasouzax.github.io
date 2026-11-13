/*
 * Shared message envelope: Web Crypto AES-256-GCM with a fresh 96-bit nonce per send.
 * Room, idempotency id and authenticated author are bound as additional data.
 * Keys are generated/imported only by the browser; the API receives envelopes only.
 */
export type Work_Envelope = { v: 1, iv: string, ciphertext: string }
export type Work_Context = { room: string, id: string, author: "owner" | "client" }
export const work_text_limit = 8000

export function encode_key(bytes: Uint8Array): string {
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

export function decode_key(value: string): Uint8Array<ArrayBuffer> {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid encoded key or message")
    return Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), char => char.charCodeAt(0))
}

async function import_key(value: string): Promise<CryptoKey> {
    const bytes = decode_key(value)
    if (bytes.length !== 32) throw new Error("The shared key must contain 32 random bytes")
    return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"])
}

function additional_data(context: Work_Context): Uint8Array<ArrayBuffer> {
    return new TextEncoder().encode(JSON.stringify(["jazu-work-v1", context.room, context.id, context.author]))
}

export async function encrypt_message(key: string, text: string, context: Work_Context): Promise<Work_Envelope> {
    const bytes = new TextEncoder().encode(text)
    if (!text.trim() || bytes.length > work_text_limit) throw new Error("Write a message of up to 8,000 UTF-8 bytes")
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: additional_data(context), tagLength: 128 }, await import_key(key), bytes)
    return { v: 1, iv: encode_key(iv), ciphertext: encode_key(new Uint8Array(ciphertext)) }
}

export async function decrypt_message(key: string, envelope: Work_Envelope, context: Work_Context): Promise<string> {
    if (envelope.v !== 1 || decode_key(envelope.iv).length !== 12) throw new Error("Unsupported encrypted message")
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode_key(envelope.iv), additionalData: additional_data(context), tagLength: 128 }, await import_key(key), decode_key(envelope.ciphertext))
    return new TextDecoder("utf-8", { fatal: true }).decode(plain)
}
