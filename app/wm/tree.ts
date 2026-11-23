/* i3 and Sway expose the same container tree and command result protocol. */
import type { Native_Window } from "../../shared/host/desktop.ts"
export function tree_windows(value: any): Native_Window[] {
    const out: Native_Window[] = []
    const visit = (node: any) => {
        if (!node || typeof node !== "object") return
        if ((node.window || node.app_id) && node.rect && Number.isSafeInteger(node.id)) out.push({ id: String(node.id), title: String(node.name || "Untitled"), app: String(node.app_id || node.window_properties?.class || ""), x: node.rect.x, y: node.rect.y, width: node.rect.width, height: node.rect.height })
        for (const child of [...(node.nodes || []), ...(node.floating_nodes || [])]) visit(child)
    }
    visit(value)
    return out
}
export function check_result(text: string): void {
    const results = JSON.parse(text)
    if (!Array.isArray(results)) throw new Error("Invalid window manager response")
    const failure = results.find((result: { success?: boolean, error?: string }) => result.success !== true)
    if (failure) throw new Error(failure.error || "Window manager rejected the command")
}
