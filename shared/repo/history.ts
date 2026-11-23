/** Bounded public repository history contract shared by the origin and desktop. */
export type History_Commit = { id: string, parents: string[], timestamp: number, subject: string }
export type History_Ref = { name: string, hash: string, commit?: string }
export const history_limit = 100
export const git_oid = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/

export function history_commits(value: unknown): History_Commit[] {
    const list = (value as { commits?: unknown })?.commits
    if (!Array.isArray(list) || list.length > history_limit) throw new Error("Invalid repository history")
    const ids = new Set<string>()
    return list.map(item => {
        if (!item || !git_oid.test(item.id) || ids.has(item.id) || typeof item.subject !== "string" || item.subject.length > 4096
            || typeof item.timestamp !== "number" || !Number.isFinite(new Date(item.timestamp * 1000).getTime())
            || !Array.isArray(item.parents) || item.parents.length > 32 || !item.parents.every((id: unknown) => typeof id === "string" && git_oid.test(id))) throw new Error("Invalid repository commit")
        ids.add(item.id)
        return { id: item.id, parents: [...new Set<string>(item.parents)], timestamp: item.timestamp, subject: item.subject }
    })
}

export function history_refs(value: unknown): History_Ref[] {
    const list = (value as { refs?: unknown })?.refs
    if (!Array.isArray(list) || list.length > 2000) throw new Error("Invalid repository refs")
    return list.map(item => {
        if (!item || typeof item.name !== "string" || !/^refs\/(?:heads|tags)\/[^\s\x00-\x1f]+$/.test(item.name) || item.name.length > 1024
            || !git_oid.test(item.hash) || (item.commit !== undefined && !git_oid.test(item.commit))) throw new Error("Invalid repository ref")
        return { name: item.name, hash: item.hash, ...(item.commit ? { commit: item.commit } : {}) }
    })
}
