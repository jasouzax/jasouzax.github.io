/* Command-level regressions for each compositor, including IPC failure and injection boundaries. */
import { test } from "node:test"
import assert from "node:assert/strict"
import { Window_Manager, detect_wm } from "../../app/wm.ts"
import { Native_IO } from "../../app/io.ts"
import { parse_desktop_request } from "../../shared/host/desktop.ts"

test("desktop RPC rejects malformed ranges, traversal payloads and compositor syntax", () => {
    for (const value of [{ op: "place", id: "1]; exec sh", rect: { x: 0, y: 0, width: 10, height: 10 } }, { op: "place", id: "1", rect: { x: 0, y: 0, width: -1, height: 10 } }, { op: "volume", level: NaN }, { op: "volume", muted: "false" }, { op: "key", key: "Alt+Tab;shutdown" }, { op: "fs", request: { op: "write", path: "/x", offset: -1, data: "" } }, { op: "fs", request: { op: "remove", path: "/x", recursive: "false" } }]) assert.throws(() => parse_desktop_request(value))
    assert.deepEqual(parse_desktop_request({ op: "place", id: "0xabc", rect: { x: -5, y: 0, width: 1920, height: 1080, ignored: 2 } }), { op: "place", id: "0xabc", rect: { x: -5, y: 0, width: 1920, height: 1080 } })
})

test("i3/Sway discover floating and tiled clients, place by container ID and surface rejection", async () => {
    for (const backend of ["i3", "sway"] as const) {
        const calls: unknown[] = []
        const wm = new Window_Manager(backend, async (file, args) => {
            calls.push([file, args])
            return args.includes("get_tree") ? JSON.stringify({ nodes: [{ id: 5, window: 100, name: "Editor", window_properties: { class: "Code" }, rect: { x: 1, y: 2, width: 300, height: 400 } }], floating_nodes: [{ nodes: [{ id: 7, app_id: "org.term", name: "Terminal", rect: { x: 4, y: 5, width: 600, height: 400 } }] }] }) : '[{"success":true}]'
        })
        assert.deepEqual((await wm.windows()).map(item => item.id), ["5", "7"])
        await wm.act("place", "5", { x: -100, y: 20, width: 800, height: 600 })
        await wm.act("focus", "7")
        assert.deepEqual(calls[1], [backend === "sway" ? "swaymsg" : "i3-msg", ["-r", "[con_id=5] floating enable, [con_id=5] resize set 800 px 600 px, [con_id=5] move position -100 px 20 px"]])
        await assert.rejects(new Window_Manager(backend, async () => '[{"success":false,"error":"No matching node"}]').act("focus", "8"), /No matching node/)
    }
})

test("Hyprland and X11 discover windows and use separate argument vectors for placement", async () => {
    const calls: unknown[] = []
    const hypr = new Window_Manager("hyprland", async (file, args) => { calls.push([file, args]); return args.includes("clients") ? '[{"address":"0xabc","title":"Term","class":"foot","at":[10,20],"size":[500,400]}]' : "ok" })
    assert.equal((await hypr.windows())[0].width, 500)
    await hypr.act("place", "0xabc", { x: 1, y: 2, width: 3, height: 4 })
    assert.deepEqual(calls.slice(1), [["hyprctl", ["dispatch", "setfloating", "address:0xabc"]], ["hyprctl", ["dispatch", "resizewindowpixel", "exact 3 4,address:0xabc"]], ["hyprctl", ["dispatch", "movewindowpixel", "exact 1 2,address:0xabc"]]])
    const x11 = new Window_Manager("x11", async (_file, args) => args.includes("-lGx") ? "0x00abc 0 10 20 500 400 XTerm.xterm host Terminal title\n" : "")
    assert.deepEqual(await x11.windows(), [{ id: "0x00abc", title: "Terminal title", app: "XTerm.xterm", x: 10, y: 20, width: 500, height: 400 }])
    await assert.rejects(hypr.act("focus", "0x123,exec,shutdown"), /Invalid/)
    assert.equal(detect_wm({ SWAYSOCK: "/sway", DISPLAY: ":1" }), "sway")
    assert.equal(detect_wm({ HYPRLAND_INSTANCE_SIGNATURE: "a", SWAYSOCK: "/sway" }), "hyprland")
    assert.equal(detect_wm({}), null)
})

test("audio reads mute state and native keys remain unavailable on Wayland", async () => {
    const calls: unknown[] = [], io = new Native_IO(async (file, args) => { calls.push([file, args]); return "Volume: 0.42 [MUTED]" }, { DISPLAY: ":1" })
    assert.deepEqual(await io.volume(0.42, true), { level: 0.42, muted: true })
    await io.key("Alt+Tab")
    assert.deepEqual(calls.at(-1), ["xdotool", ["key", "--clearmodifiers", "Alt+Tab"]])
    await assert.rejects(new Native_IO(async () => "", { WAYLAND_DISPLAY: "wayland-0", DISPLAY: ":1" }).key("a"), /Wayland/)
})
