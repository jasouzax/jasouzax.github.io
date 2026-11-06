import type { proc_info } from "./proc_types.ts"

export function browser_system(items: proc_info[]): { uptime: number, total: number, used: number, cores: number, processes: number } {
    const memory = (performance as Performance & { memory?: { jsHeapSizeLimit: number, usedJSHeapSize: number } }).memory
    return { uptime: performance.now() / 1000, total: memory?.jsHeapSizeLimit ?? 0, used: memory?.usedJSHeapSize ?? 0,
        cores: typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 1 : 1, processes: items.filter(item => item.running).length }
}

// Minimal Linux proc records consumed by BusyBox ps. Values describe browser
// processes; CPU/memory accounting remains unavailable until the host measures it.
export function proc_record(items: proc_info[], path: string): string | null {
    const system = browser_system(items)
    if (path === "/proc/uptime") return `${Math.floor(performance.now() / 1000)} 0\n`
    if (path === "/proc/meminfo") return `MemTotal: ${Math.floor(system.total / 1024)} kB\nMemAvailable: ${Math.max(0, Math.floor((system.total-system.used) / 1024))} kB\nMemFree: ${Math.max(0, Math.floor((system.total-system.used) / 1024))} kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n`
    if (path === "/proc/cpuinfo") return Array.from({ length: system.cores }, (_, index) => `processor\t: ${index}\nmodel name\t: WebAssembly browser worker\nvendor_id\t: Browser\ncpu cores\t: ${system.cores}\n`).join("\n")
    if (path === "/proc/version") return "Jazu browser kernel 0.12 (WebAssembly)\n"
    const match = /^\/proc\/(\d+)\/(cmdline|status|stat|cwd)$/.exec(path)
    if (!match) return null
    const item = items.find(item => item.pid === Number(match[1]))
    if (!item) return null
    const name = (item.argv[0].split("/").pop() ?? "wasm").replace(/[()\n]/g, "_")
    if (match[2] === "cmdline") return item.argv.join("\0") + "\0"
    if (match[2] === "status") return `Name:\t${name}\nPid:\t${item.pid}\nPPid:\t${item.ppid}\nState:\t${item.running ? "R" : "Z"}\nUid:\t${Array(4).fill(item.uid ?? 1000).join("\t")}\nGid:\t${Array(4).fill(item.gid ?? 1000).join("\t")}\n`
    if (match[2] === "stat") return `${item.pid} (${name}) ${item.running ? "R" : "Z"} ${item.ppid} ${item.pid} ${item.pid} 0 0 0 0 0 0 0 0 0 0 0 20 0 1 0 0 0 0\n`
    return null
}
