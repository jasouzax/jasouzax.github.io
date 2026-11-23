/* i3 container tree and targeted commands; Sway reuses this compatible IPC dialect. */
import type { Native_Rect, Native_Window } from "../../shared/host/desktop.ts"
import type { Command } from "./command.ts"
import { tree_windows, check_result } from "./tree.ts"
export class I3_Manager {
    constructor(readonly run: Command, readonly binary = "i3-msg") {}
    async windows(): Promise<Native_Window[]> { return tree_windows(JSON.parse(await this.run(this.binary, ["-r", "-t", "get_tree"]))) }
    async act(action: "place" | "focus" | "window_close", id: string, rect?: Native_Rect): Promise<void> {
        if (!/^\d+$/.test(id)) throw new Error("Expected container ID")
        const prefix = `[con_id=${id}]`
        const value = action === "place" ? `${prefix} floating enable, ${prefix} resize set ${rect!.width} px ${rect!.height} px, ${prefix} move position ${rect!.x} px ${rect!.y} px` : `${prefix} ${action === "focus" ? "focus" : "kill"}`
        check_result(await this.run(this.binary, ["-r", value]))
    }
}
