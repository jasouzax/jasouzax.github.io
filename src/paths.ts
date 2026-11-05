import { resolve, relative, sep, isAbsolute } from "node:path"
import { existsSync, realpathSync } from "node:fs"

export function inside(base: string, target: string): boolean {
    const path = relative(resolve(base), resolve(target))
    return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path)
}

export function output_directory(root: string, out: string): string {
    const base = resolve(root)
    const target = resolve(root, out)
    const path = relative(base, target)
    if (!path || !inside(base, target) || ["src", "content", "tools", "tests", "gen-11", "node_modules"].includes(path.split(sep)[0]) || path.split(sep).some(part => part.startsWith("."))) {
        throw new Error("Output must be a generated directory inside the project, outside source/content/cache")
    }
    // Resolve existing ancestors too, so a junction cannot redirect a build/clean outside the project.
    let ancestor = target
    while (!existsSync(ancestor)) ancestor = resolve(ancestor, "..")
    if (!inside(realpathSync(base), realpathSync(ancestor))) throw new Error("Output junction escapes project")
    return target
}

export function output_file(out: string, name: string): string {
    const target = resolve(out, name)
    if (!name || !inside(out, target) || target === resolve(out)) throw new Error(`Unsafe generated path: ${name}`)
    if (existsSync(out)) {
        let ancestor = target
        while (!existsSync(ancestor)) ancestor = resolve(ancestor, "..")
        if (!inside(realpathSync(out), realpathSync(ancestor))) throw new Error(`Generated path junction escapes output: ${name}`)
    }
    return target
}
