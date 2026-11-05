import type { proc_info } from "./proc_types.ts"

// Minimal Linux proc records consumed by BusyBox ps. Values describe browser
// processes; CPU/memory accounting remains unavailable until the host measures it.
export function proc_record(items: proc_info[], path: string): string | null {
    if (path === "/proc/uptime") return `${Math.floor(performance.now() / 1000)} 0\n`
    const match = /^\/proc\/(\d+)\/(cmdline|status|stat|cwd)$/.exec(path)
    if (!match) return null
    const item = items.find(item => item.pid === Number(match[1]))
    if (!item) return null
    const name = (item.argv[0].split("/").pop() ?? "wasm").replace(/[()\n]/g, "_")
    if (match[2] === "cmdline") return item.argv.join("\0") + "\0"
    if (match[2] === "status") return `Name:\t${name}\nPid:\t${item.pid}\nPPid:\t${item.ppid}\nState:\t${item.running ? "R" : "Z"}\nUid:\t1000\t1000\t1000\t1000\nGid:\t1000\t1000\t1000\t1000\n`
    if (match[2] === "stat") return `${item.pid} (${name}) ${item.running ? "R" : "Z"} ${item.ppid} ${item.pid} ${item.pid} 0 0 0 0 0 0 0 0 0 0 0 20 0 1 0 0 0 0\n`
    return null
}
