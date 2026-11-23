import type { desk_window } from "../index.ts"
import { bind_volume } from "./volume.ts"
import { bind_fullscreen } from "./fullscreen.ts"
export { window_audio_enabled } from "./volume.ts"
const cleanups = new WeakMap<desk_window, () => void>()
export function dispose_window_controls(item: desk_window): void { cleanups.get(item)?.(); cleanups.delete(item) }

// These controls belong to the window, so changing its viewer or mode keeps the preference.
export function bind_window_controls(item: desk_window): void {
    const dispose_volume = bind_volume(item)
    const dispose_fullscreen = bind_fullscreen(item)
    cleanups.set(item, () => { dispose_volume(); dispose_fullscreen() })
}
