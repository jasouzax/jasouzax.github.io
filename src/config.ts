/* CLI responsibilities for config. */

export type flags = Record<string, string | boolean>

export function parse_args(args: string[]): { words: string[], flags: flags } {
    const words: string[] = []
    const flags: flags = {}
    for (let index = 0; index < args.length; index++) {
        const arg = args[index]
        if (!arg.startsWith("--")) {
            words.push(arg)
            continue
        }
        const name = arg.slice(2)
        const next = args[index + 1]
        if (next && !next.startsWith("--") && ["out", "host", "port", "root", "date", "out_file", "target", "overlay", "state_file", "commit", "message", "config", "role", "project", "branch", "base_url", "pages_project", "assets_bucket"].includes(name)) {
            flags[name] = next
            index++
        } else flags[name] = true
    }
    return { words, flags }
}
