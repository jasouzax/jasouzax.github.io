/* Line comparison for independently opened split resources. Bounded Myers diff avoids freezing the editor on unrelated large files. */
import { diffLines } from "diff"

export function comparison_lines(source: string, output: string): { added: Set<number>, removed: Map<number, number>, limited: boolean } {
    const added = new Set<number>(), removed = new Map<number, number>()
    const changes = diffLines(source, output, { timeout: 40, maxEditLength: 4000 })
    if (!changes) return { added, removed, limited: true }
    let line = 0
    for (const change of changes) {
        if (change.removed) removed.set(line, (removed.get(line) ?? 0) + change.count)
        else {
            if (change.added) for (let index = 0; index < change.count; index++) added.add(line + index)
            line += change.count
        }
    }
    // A deletion at EOF belongs to the bottom of the last visible line.
    const end = Math.max(0, output.split("\n").length - 1)
    if (removed.has(end + 1)) { removed.set(end, (removed.get(end) ?? 0) + removed.get(end + 1)!); removed.delete(end + 1) }
    return { added, removed, limited: false }
}
