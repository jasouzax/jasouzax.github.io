/* EWMH-compatible X11 window managers are controlled with wmctrl argument vectors. */
import type { Native_Rect, Native_Window } from "../../shared/host/desktop.ts"
import type { Command } from "./command.ts"
export class X11_Manager {
    constructor(readonly run: Command) {}
    async windows(): Promise<Native_Window[]> {
        return (await this.run("wmctrl", ["-lGx"])).split("\n").flatMap(line => {
            const match = /^(0x[\da-f]+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+\S+\s*(.*)$/i.exec(line)
            return match ? [{ id: match[1], title: match[8], app: match[7], x: +match[3], y: +match[4], width: +match[5], height: +match[6] }] : []
        })
    }
    async act(action: "place" | "focus" | "window_close", id: string, rect?: Native_Rect): Promise<void> {
        if (action === "place") {
            await this.run("wmctrl", ["-ir", id, "-b", "remove,maximized_vert,maximized_horz"])
            await this.run("wmctrl", ["-ir", id, "-e", `0,${rect!.x},${rect!.y},${rect!.width},${rect!.height}`])
        } else await this.run("wmctrl", [action === "focus" ? "-ia" : "-ic", id])
    }
}
