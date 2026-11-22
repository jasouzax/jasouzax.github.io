/*
 * The public snapshot of the Pi: what the logged-out /server window shows.
 *
 * Entities
 *   public_structure   the fastfetch modules that are safe to show to anybody
 *   take_snapshot      runs `fastfetch --pipe`, or describes the machine with Node's `os` module when the binary is missing
 *   Run_Command        the one way this file starts a process, replaceable in tests
 *
 * Limits
 *   The default structure leaves out the user name, host name (both are in Title), local IP and locale, because the
 *   result is cached by the Worker and shown to everybody. The text is capped and stripped of escape sequences.
 */
import { execFile } from "child_process"
import * as os from "os"

export type Snapshot = { text: string, taken_at: number }
export type Run_Command = (file: string, args: string[], timeout_ms: number) => Promise<string>

// No Title (user@host), no LocalIp, no Locale, no Wifi/DNS: nothing that identifies the network or the account
export const public_structure = "OS:Host:Kernel:Uptime:Packages:Shell:Terminal:CPU:GPU:Memory:Swap:Disk:Battery"
export const max_snapshot_chars = 8192

const run_command: Run_Command = (file, args, timeout_ms) => new Promise((resolve, reject) => {
    execFile(file, args, { timeout: timeout_ms, maxBuffer: 256 * 1024, windowsHide: true }, (error, stdout) => error ? reject(error) : resolve(stdout))
})

// CSI and OSC sequences, which `--pipe` should not emit but a fastfetch config can
const escapes = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g

export function clean_text(raw: string): string {
    const text = raw.replace(escapes, "").replace(/\r/g, "").replace(/[^\S\n]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim()
    return text.length > max_snapshot_chars ? text.slice(0, max_snapshot_chars) : text
}

function format_uptime(seconds: number): string {
    const days = Math.floor(seconds / 86400)
    const hours = Math.floor(seconds % 86400 / 3600)
    const minutes = Math.floor(seconds % 3600 / 60)
    return [days && `${days} day${days === 1 ? "" : "s"}`, hours && `${hours} hour${hours === 1 ? "" : "s"}`, `${minutes} min${minutes === 1 ? "" : "s"}`].filter(Boolean).join(", ")
}

const gib = (bytes: number) => (bytes / 1024 ** 3).toFixed(2) + " GiB"

// Used when fastfetch is not installed: the same labels, from what Node knows
export function fallback_text(): string {
    const cpus = os.cpus()
    const total = os.totalmem()
    const used = total - os.freemem()
    const lines = [
        ["OS", `${os.type()} ${os.release()} ${os.arch()}`],
        ["Kernel", `${os.type()} ${os.release()}`],
        ["Uptime", format_uptime(os.uptime())],
        ["CPU", cpus.length ? `${cpus[0].model.trim()} (${cpus.length})` : "unknown"],
        ["Memory", `${gib(used)} / ${gib(total)} (${Math.round(used / total * 100)}%)`],
    ]
    return lines.map(([label, value]) => `${label}: ${value}`).join("\n")
}

export async function take_snapshot(structure: string, run: Run_Command = run_command, now: () => number = Date.now): Promise<Snapshot> {
    let text = ""
    try {
        text = clean_text(await run("fastfetch", ["--pipe", "--logo", "none", "--structure", structure || public_structure], 10_000))
    } catch { /* not installed, or it failed: the fallback below */ }
    return { text: text || fallback_text(), taken_at: now() }
}
