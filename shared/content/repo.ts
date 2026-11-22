/* Ordered typed repository sources; only reviewed, credential-free sources may become public fallbacks. */
export type Repo_Type = "git" | "npm" | "pypi" | "docker" | "deb" | "rpm"
export type Repo_Source = { type: Repo_Type, value: string }
const types: Repo_Type[] = ["git", "npm", "pypi", "docker", "deb", "rpm"]

function git_remote(value: string): string {
    if (!value || /[\s\x00-\x1f]/.test(value) || value.startsWith("-")) throw new Error("repo must be a credential-free HTTPS or SSH repository URL")
    if (/^[a-zA-Z0-9_.-]+@[a-zA-Z0-9.-]+:[a-zA-Z0-9_./-]+$/.test(value)) return value
    const normalized = /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\/[^/]/.test(value) ? `https://${value}` : value
    let url: URL
    try { url = new URL(normalized) } catch { throw new Error("repo must be a hostname/path, HTTPS URL or SSH URL") }
    if (!["https:", "ssh:"].includes(url.protocol) || !url.hostname || url.password || (url.protocol === "https:" && url.username) || url.search || url.hash || url.pathname === "/") throw new Error("repo must be a credential-free HTTPS or SSH repository URL")
    return normalized
}

export function repo_sources(value: string): Repo_Source[] {
    if (!value.trim()) return []
    return value.split(",").map(part => {
        const source = part.trim(), match = /^(git|npm|pypi|docker|deb|rpm):(.*)$/.exec(source)
        const type = (match?.[1] ?? "git") as Repo_Type, raw = match?.[2] ?? source
        if (!types.includes(type) || !raw || /[\s\x00-\x1f]/.test(raw)) throw new Error("repo sources must be nonempty type:value entries")
        if (type === "git") return { type, value: git_remote(raw) }
        if (type === "npm" && !/^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/.test(raw)) throw new Error("Invalid npm repository source")
        if (type === "pypi" && !/^[a-z0-9][a-z0-9._-]*$/i.test(raw)) throw new Error("Invalid pypi repository source")
        if (type === "docker" && (!/^[a-z0-9][a-z0-9._:/@-]*$/.test(raw) || raw.includes("://") || raw.includes("@") && !/@sha256:[a-f0-9]{64}$/.test(raw))) throw new Error("Invalid docker repository source")
        if (type === "deb" || type === "rpm") {
            let url: URL
            try { url = new URL(raw) } catch { throw new Error("Package repository sources require HTTPS") }
            if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("Package repository sources require credential-free HTTPS")
        }
        return { type, value: raw }
    })
}

export function repository_remote(value: string): string | undefined { return repo_sources(value).find(source => source.type === "git")?.value }
