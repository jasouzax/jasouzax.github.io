/* Hyprland addresses clients with compositor-owned hexadecimal handles. */
import type { Native_Rect, Native_Window } from "../../shared/host/desktop.ts"
import type { Command } from "./command.ts"
export class Hyprland_Manager {
    constructor(readonly run: Command) {}
    async windows(): Promise<Native_Window[]> { return JSON.parse(await this.run("hyprctl", ["-j", "clients"])).map((node: any) => ({ id: node.address, title: node.title, app: node.class, x: node.at[0], y: node.at[1], width: node.size[0], height: node.size[1] })) }
    async act(action: "place" | "focus" | "window_close", id: string, rect?: Native_Rect): Promise<void> {
        if (!/^0x[\da-f]+$/i.test(id)) throw new Error("Expected Hyprland address")
        const address = `address:${id}`
        const dispatch = async (name: string, value: string) => {
            const result = (await this.run("hyprctl", ["dispatch", name, value])).trim()
            if (result !== "ok") throw new Error(result || "Hyprland rejected the command")
        }
        if (action === "place") {
            await dispatch("setfloating", address)
            await dispatch("resizewindowpixel", `exact ${rect!.width} ${rect!.height},${address}`)
            await dispatch("movewindowpixel", `exact ${rect!.x} ${rect!.y},${address}`)
        } else await dispatch(action === "focus" ? "focuswindow" : "closewindow", address)
    }
}
