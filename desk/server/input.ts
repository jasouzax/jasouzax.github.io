/*
 * How a person's pointer and keyboard become the events of the Pi's Chromium window (no DOM: plain numbers in, events out).
 *
 * Entities
 *   page_point      a screen position inside the picture -> the page's own CSS pixels (any picture size maps onto the same spot)
 *   modifiers       shift / ctrl / alt / meta of an event as the names the agent expects
 *   key_name        Electron's names for keys that are not one character
 *   Click_Counter   one press, a double click, a triple click (presses near each other in quick succession)
 *   wheel_pixels    wheel deltas in lines or pages -> page pixels
 *   key_events      what a key press sends: text for characters, key events for everything else, nothing for IME in progress
 *   copy_shortcut   Ctrl/Cmd+C or +X
 */
import type { Input_Event } from "../../shared/protocol/wire.ts"

export const double_click_ms = 400
export const tap_slop_px = 8

const key_names: Record<string, string> = { ArrowLeft: "Left", ArrowRight: "Right", ArrowUp: "Up", ArrowDown: "Down", " ": "Space" }
export function key_name(key: string): string { return key_names[key] ?? key }

export type Box = { left: number, top: number, width: number, height: number }
export type Target_Size = { width: number, height: number }

export function page_point(box: Box, target: Target_Size | null, point: { clientX: number, clientY: number }): { x: number, y: number } {
    const width = box.width || 1
    const height = box.height || 1
    return { x: ((point.clientX - box.left) / width) * (target?.width ?? width), y: ((point.clientY - box.top) / height) * (target?.height ?? height) }
}

export function modifiers(event: { shiftKey: boolean, ctrlKey: boolean, altKey: boolean, metaKey: boolean }): string[] {
    return [event.shiftKey && "shift", event.ctrlKey && "ctrl", event.altKey && "alt", event.metaKey && "meta"].filter(Boolean) as string[]
}

export function mouse_button(button: number): "left" | "middle" | "right" {
    return button === 1 ? "middle" : button === 2 ? "right" : "left"
}

export class Click_Counter {
    count = 0
    #time = 0
    #x = 0
    #y = 0
    press(time: number, x: number, y: number): number {
        const repeat = time - this.#time < double_click_ms && Math.hypot(x - this.#x, y - this.#y) < tap_slop_px * 2
        this.count = repeat ? Math.min(this.count + 1, 3) : 1
        this.#time = time; this.#x = x; this.#y = y
        return this.count
    }
}

// Lines and pages are turned into pixels, as every browser does; `scale` is how many page pixels one screen pixel is (zoomed pictures)
export function wheel_pixels(delta: { deltaX: number, deltaY: number, deltaMode: number }, page_height: number, scale: number): { dx: number, dy: number } {
    const unit = delta.deltaMode === 1 ? 40 : delta.deltaMode === 2 ? page_height : 1
    return { dx: delta.deltaX * unit * scale, dy: delta.deltaY * unit * scale }
}

export function copy_shortcut(event: { ctrlKey: boolean, metaKey: boolean, altKey: boolean, shiftKey: boolean, key: string }): "copy" | "cut" | null {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return null
    const key = event.key.toLowerCase()
    return key === "c" ? "copy" : key === "x" ? "cut" : null
}

export type Key_Event = { key: string, isComposing?: boolean, ctrlKey: boolean, metaKey: boolean, altKey: boolean, shiftKey: boolean }

// "ignore": the field handles it (IME, soft keyboard, paste); "copy"/"cut": a clipboard request; otherwise the events to send
export function key_events(action: "down" | "up", event: Key_Event): Input_Event[] | "ignore" | "copy" | "cut" {
    if (event.isComposing || event.key === "Unidentified" || event.key === "Process") return "ignore"
    const shortcut = event.ctrlKey || event.metaKey || event.altKey
    const copy = copy_shortcut(event)
    if (copy) return action === "down" ? copy : "ignore"
    if (action === "down") {
        // characters travel as text (which also handles layouts and accents), everything else as keys
        if (event.key.length === 1 && !shortcut) return [{ kind: "text", text: event.key }]
        // the paste event brings the clipboard along, so the shortcut itself stays in the field
        if (shortcut && event.key.toLowerCase() === "v") return "ignore"
        return [{ kind: "key", action: "down", key: key_name(event.key), modifiers: modifiers(event) }]
    }
    if (event.key.length === 1 && !shortcut) return "ignore"
    if (shortcut && event.key.toLowerCase() === "v") return "ignore"
    return [{ kind: "key", action: "up", key: key_name(event.key), modifiers: modifiers(event) }]
}
