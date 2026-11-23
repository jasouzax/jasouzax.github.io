/* Capture current documents synchronously; restoring never writes source files or resumes live processes. */
import { state, working_directory, capture_layout, restore_layout, new_window, close_window, type desk_window } from "../../index.ts"
import { latest_bytes, is_dirty, document_of, announce_edit, adopt } from "../../plugin/flow.ts"
import { open_source, render_window } from "../../window/index.ts"
import { window_audio_enabled, window_volume, set_window_audio } from "../../action/volume.ts"
import { remote_root_active } from "../../fs/opfs.ts"
import { is_server_page } from "../../server/text.ts"
import { validate_snapshot, type Desktop_Snapshot } from "./model.ts"

const identities = new WeakMap<object, number>(); let next_identity = 0
function identity(value: object | null): number { if (!value) return 0; if (!identities.has(value)) identities.set(value, ++next_identity); return identities.get(value)! }
export function desktop_signature(): string {
    return JSON.stringify([working_directory(), capture_layout(), state.windows.map(item => [item.id, item.parent?.id, item.name, item.mime, item.path, item.icon, item.mode, item.picks, item.pid, item.error, item.hidden, item.minimized, identity(item.file), identity(latest_bytes(item)), is_dirty(item), item.dirty, window_audio_enabled(item), window_volume(item)])])
}
export function capture_desktop(): Desktop_Snapshot {
    if (remote_root_active() || is_server_page(location.pathname) || /(?:^|\/)work(?:\/|$)/.test(location.pathname)) throw new Error("Live desktops are not supported")
    const snapshot: Desktop_Snapshot = { cwd: working_directory(), layout: capture_layout(), windows: state.windows.map(item => {
        if (item.pid !== null || item.error) throw new Error("Live or unavailable windows are not supported")
        const root = document_of(item), dirty = is_dirty(item) || item.dirty, bytes = latest_bytes(item)
        const draft = dirty && root === item && bytes ? new Blob([new Uint8Array(bytes)], { type: item.mime }) : null
        const path = /^(?:blob|data):/.test(item.path) ? "" : item.path
        return { id: item.id, parent: item.parent?.id ?? null, name: item.name, mime: item.mime, mode: item.mode, path, icon: item.icon, file: item.file, draft, dirty, hidden: Boolean(item.hidden), minimized: item.minimized, picks: { ...item.picks }, audio: { enabled: window_audio_enabled(item), volume: window_volume(item) } }
    }) }
    validate_snapshot(snapshot)
    return snapshot
}
export async function prepare_desktop(snapshot: Desktop_Snapshot): Promise<Map<number, Uint8Array>> {
    validate_snapshot(snapshot)
    const drafts = new Map<number, Uint8Array>()
    await Promise.all(snapshot.windows.map(async item => { if (item.draft) drafts.set(item.id, new Uint8Array(await item.draft.arrayBuffer())) }))
    return drafts
}
export async function restore_desktop(snapshot: Desktop_Snapshot, drafts: Map<number, Uint8Array>, current: () => boolean): Promise<void> {
    if (!current()) return
    for (const item of [...state.windows]) close_window(item)
    state.desk!.dataset.cwd = snapshot.cwd
    const windows = new Map<number, desk_window>()
    for (const saved of snapshot.windows) {
        const item = new_window()
        if (!item) throw new Error("Cannot restore desktop window")
        Object.assign(item, { name: saved.name, mime: saved.mime, mode: saved.mode, path: saved.path, icon: saved.icon, file: saved.file, save: null, dirty: saved.dirty, minimized: saved.minimized, hidden: saved.hidden, candidates: saved.mime ? [saved.mime] : [], picks: { ...saved.picks } })
        windows.set(saved.id, item)
    }
    for (const saved of snapshot.windows) if (saved.parent) adopt(windows.get(saved.parent)!, windows.get(saved.id)!)
    for (const [id, bytes] of drafts) announce_edit(windows.get(id)!, bytes)
    const drawn = new Set<number>()
    const draw = (id: number) => {
        if (drawn.has(id)) return
        const saved = snapshot.windows.find(item => item.id === id)!
        if (saved.parent) draw(saved.parent)
        drawn.add(id); render_window(windows.get(id)!)
    }
    for (const saved of snapshot.windows) draw(saved.id)
    for (const saved of snapshot.windows) {
        const item = windows.get(saved.id)!
        set_window_audio(item, saved.audio.enabled, saved.audio.volume)
        if (saved.mime === "inode/directory" && (!saved.parent || saved.picks.own)) { await open_source(item, saved.path); item.mode = saved.mode; render_window(item) }
        if (!current()) return
    }
    if (!windows.size) new_window()
    restore_layout(snapshot.layout, windows)
}
