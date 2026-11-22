// The virtual filesystem accepts both file:///home/user and file://home/user.
export function local_file_path(uri: string): string | null {
    const value = uri.trim()
    let path: string
    if (/^file:\/\//i.test(value)) path = value.slice(7).replace(/^localhost\//i, "/")
    else if (value.startsWith("/")) path = value
    else return null
    const parts: string[] = []
    for (const part of path.split("/")) {
        if (!part || part === ".") continue
        if (part === "..") parts.pop()
        else parts.push(part)
    }
    return "/" + parts.join("/")
}
