/* Local OS audio and input adapters. Unsupported backends report errors instead of silently emulating success. */
import { command, type Command } from "./wm/command.ts"
export class Native_IO {
    constructor(readonly run: Command = command, readonly env: NodeJS.ProcessEnv = process.env) {}
    async volume(level?: number, muted?: boolean): Promise<{ level: number, muted: boolean }> {
        if (level !== undefined) await this.run("wpctl", ["set-volume", "@DEFAULT_AUDIO_SINK@", String(level)])
        if (muted !== undefined) await this.run("wpctl", ["set-mute", "@DEFAULT_AUDIO_SINK@", muted ? "1" : "0"])
        const value = await this.run("wpctl", ["get-volume", "@DEFAULT_AUDIO_SINK@"])
        const match = /Volume:\s*(\d+(?:\.\d+)?)/.exec(value)
        if (!match) throw new Error("Unable to read the system audio level")
        return { level: Math.min(1, Number(match[1])), muted: value.includes("[MUTED]") }
    }
    async key(key: string): Promise<void> {
        if (!/^[A-Za-z0-9_+]{1,80}$/.test(key)) throw new Error("Invalid key combination")
        if (!this.env.DISPLAY || this.env.WAYLAND_DISPLAY) throw new Error("Global key injection requires X11; Wayland input stays controlled by the compositor")
        await this.run("xdotool", ["key", "--clearmodifiers", key])
    }
}
