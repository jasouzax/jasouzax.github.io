export function folder_cover_plan<T extends { kind: "file" | "dir" }>(children: T[]): { files: T[], nested: boolean, count: number } {
    const files = children.filter(child => child.kind === "file")
    return { files: files.slice(0, 4), nested: children.some(child => child.kind === "dir"), count: files.length }
}

export function folder_change(current: string, changed: string): "contents" | "cover" | null {
    if (changed === current || current.startsWith(changed === "/" ? "/" : `${changed}/`)) return "contents"
    const parent = changed.slice(0, changed.lastIndexOf("/")) || "/"
    return parent === current ? "cover" : null
}
