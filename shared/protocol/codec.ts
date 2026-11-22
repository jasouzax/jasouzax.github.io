/*
 * Byte helpers shared by the agent, the Worker and the page. Only Uint8Array, btoa/atob and DataView: no Buffer, so it runs everywhere.
 *
 * Entities
 *   to_base64 / from_base64        text-safe transport of bytes inside JSON frames
 *   pack_video / pack_audio        binary feed frames
 *   unpack_binary                  reads a binary frame back into its parts, null when it is malformed
 *
 * Limits
 *   from_base64 throws on invalid input; callers at a trust boundary wrap it.
 */
import { binary_audio, binary_video, audio_header_size, video_header_size } from "./wire.ts"

export function to_base64(bytes: Uint8Array): string {
    let binary = ""
    for (let start = 0; start < bytes.length; start += 0x8000) binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000))
    return btoa(binary)
}

export function from_base64(text: string): Uint8Array {
    const binary = atob(text)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
    return bytes
}

export function pack_video(id: number, jpeg: Uint8Array): Uint8Array {
    const packet = new Uint8Array(video_header_size + jpeg.length)
    packet[0] = binary_video
    new DataView(packet.buffer).setUint32(1, id)
    packet.set(jpeg, video_header_size)
    return packet
}

export function pack_audio(id: number, timestamp: number, opus: Uint8Array): Uint8Array {
    const packet = new Uint8Array(audio_header_size + opus.length)
    packet[0] = binary_audio
    const view = new DataView(packet.buffer)
    view.setUint32(1, id)
    view.setFloat64(5, timestamp)
    packet.set(opus, audio_header_size)
    return packet
}

export type Binary_Frame = { kind: "video", id: number, payload: Uint8Array } | { kind: "audio", id: number, timestamp: number, payload: Uint8Array }

export function unpack_binary(packet: Uint8Array): Binary_Frame | null {
    if (packet.length < video_header_size) return null
    const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength)
    const id = view.getUint32(1)
    if (packet[0] === binary_video) return { kind: "video", id, payload: packet.subarray(video_header_size) }
    if (packet[0] === binary_audio && packet.length >= audio_header_size) return { kind: "audio", id, timestamp: view.getFloat64(5), payload: packet.subarray(audio_header_size) }
    return null
}
