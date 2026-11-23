/* Optional live X11/i3 acceptance in an isolated Linux display; never points at the operator's desktop. */
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { setTimeout } from "node:timers/promises"
import { Window_Manager } from "../../app/wm.ts"
const i3 = new Window_Manager("i3"), x11 = new Window_Manager("x11")
const terminal = spawn("xterm", ["-title", "JAZU native test", "-geometry", "80x24", "-e", "sleep", "60"], { stdio: "inherit" })
try {
    let target
    for (let retry = 0; retry < 40 && !target; retry++) { target = (await i3.windows()).find(item => item.title === "JAZU native test"); if (!target) await setTimeout(100) }
    assert(target, "i3 discovers the actual X11 client")
    await i3.act("place", target.id, { x: 100, y: 100, width: 600, height: 400 })
    await i3.act("focus", target.id)
    const moved = (await i3.windows()).find(item => item.id === target!.id)!
    assert(Math.abs(moved.width - 600) <= 10); assert(Math.abs(moved.height - 400) <= 20); assert(Math.abs(moved.x - 100) <= 2); assert(Math.abs(moved.y - 100) <= 2)
    const native = (await x11.windows()).find(item => item.title === "JAZU native test")
    assert(native, "wmctrl discovers the same native client")
    await x11.act("place", native.id, { x: 200, y: 150, width: 500, height: 300 })
    await x11.act("focus", native.id)
    await setTimeout(200)
    const final = (await x11.windows()).find(item => item.id === native.id)!
    assert(Math.abs(final.width - 500) <= 10); assert(Math.abs(final.height - 300) <= 20)
    await i3.act("window_close", target.id)
    console.log("Live i3 and X11 discovery, placement, resize, focus and close pass")
} finally { terminal.kill() }
