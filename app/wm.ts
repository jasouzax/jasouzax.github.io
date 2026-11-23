/* Native window discovery, focus and placement. One adapter owns each compositor's command dialect. */
import type { Native_Rect, Native_Window, Wm_Backend } from "../shared/host/desktop.ts"
import { command, type Command } from "./wm/command.ts"
import { I3_Manager } from "./wm/i3.ts"
import { Sway_Manager } from "./wm/sway.ts"
import { Hyprland_Manager } from "./wm/hyprland.ts"
import { X11_Manager } from "./wm/x11.ts"
export function detect_wm(env: NodeJS.ProcessEnv = process.env): Wm_Backend | null {
    if (env.HYPRLAND_INSTANCE_SIGNATURE) return "hyprland"
    if (env.SWAYSOCK) return "sway"
    if (env.I3SOCK) return "i3"
    if (env.DISPLAY) return "x11"
    return null
}
export class Window_Manager {
    constructor(readonly backend: Wm_Backend, readonly run: Command = command) {}
    private adapter() { return this.backend === "i3" ? new I3_Manager(this.run) : this.backend === "sway" ? new Sway_Manager(this.run) : this.backend === "hyprland" ? new Hyprland_Manager(this.run) : new X11_Manager(this.run) }
    async windows(): Promise<Native_Window[]> { return this.adapter().windows() }
    async act(action: "place" | "focus" | "window_close", id: string, rect?: Native_Rect): Promise<void> {
        // IDs must be revalidated even for non-IPC callers: compositor arguments have their own command syntax.
        if (!/^(?:[0-9]{1,16}|0x[a-fA-F0-9]{1,16})$/.test(id)) throw new Error("Invalid native window ID")
        if (action === "place" && (!rect || ![rect.x, rect.y, rect.width, rect.height].every(Number.isInteger) || rect.width < 1 || rect.height < 1 || Math.abs(rect.x) > 65536 || Math.abs(rect.y) > 65536 || rect.width > 32768 || rect.height > 32768)) throw new Error("Invalid native window rectangle")
        await this.adapter().act(action, id, rect)
    }
}
