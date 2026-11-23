/** Merge nesting and immutable DAG coordinates for the bounded repository snapshot. */
import type { History_Commit, History_Ref } from "../../../shared/repo/history.ts"
import type { Map_Graph } from "../map/model.ts"

export type Commit_Entry = { commit: History_Commit, children: Commit_Entry[] }

export function history_tree(commits: History_Commit[]): Commit_Entry[] {
    const by_id = new Map(commits.map(commit => [commit.id, commit]))
    const ancestors = (id: string): Set<string> => {
        const found = new Set<string>(), pending = [id]
        while (pending.length) {
            const next = pending.pop()!
            if (found.has(next)) continue
            found.add(next)
            pending.push(...(by_id.get(next)?.parents ?? []))
        }
        return found
    }
    const parents = new Map<string, string>()
    for (const merge of [...commits].reverse()) {
        if (merge.parents.length < 2) continue
        const main = ancestors(merge.parents[0])
        for (const branch of merge.parents.slice(1)) for (const id of ancestors(branch)) {
            if (!by_id.has(id) || main.has(id) || id === merge.id || parents.has(id) || ancestors(id).has(merge.id)) continue
            parents.set(id, merge.id)
        }
    }
    const entries = new Map(commits.map(commit => [commit.id, { commit, children: [] as Commit_Entry[] }]))
    const roots: Commit_Entry[] = []
    for (const commit of commits) {
        const entry = entries.get(commit.id)!, parent = parents.get(commit.id)
        if (parent && entries.has(parent)) entries.get(parent)!.children.push(entry)
        else roots.push(entry)
    }
    return roots
}

export function history_graph(commits: History_Commit[], refs: History_Ref[], base: string): Map_Graph {
    const labels = new Map<string, string[]>()
    for (const ref of refs) {
        const id = ref.commit ?? ref.hash
        labels.set(id, [...(labels.get(id) ?? []), ref.name.replace(/^refs\/(?:heads|tags)\//, "")])
    }
    const lanes = new Map<string, number>()
    let next_lane = 1
    const nodes = commits.map((commit, index) => {
        const lane = lanes.get(commit.id) ?? 0
        commit.parents.forEach((id, parent) => { if (!lanes.has(id)) lanes.set(id, parent === 0 ? lane : next_lane++) })
        const url = new URL(base)
        url.searchParams.set("ref", commit.id)
        return { id: commit.id, name: `${commit.id.slice(0, 8)} ${commit.subject}`, info: (labels.get(commit.id) ?? []).join(", "), link: url.href, x: 30 + lane * 280, y: 30 + index * 130 }
    })
    const included = new Set(commits.map(commit => commit.id))
    return { nodes, edges: commits.flatMap(commit => commit.parents.filter(id => included.has(id)).map(to => ({ from: commit.id, to }))) }
}
