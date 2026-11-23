/** Merge history grouping excludes common ancestors; graph keeps both parent edges and peeled tag labels. */
import { test } from "node:test"
import assert from "node:assert/strict"
import { history_tree, history_graph } from "../../../../desk/menu/version/model.ts"
import { history_commits, history_refs, type History_Commit } from "../../../../shared/repo/history.ts"

const oid = (digit: string) => digit.repeat(40)
const commits: History_Commit[] = [
    { id: oid("f"), parents: [oid("d"), oid("e")], timestamp: 4, subject: "Merge feature" },
    { id: oid("d"), parents: [oid("a")], timestamp: 3, subject: "Main change" },
    { id: oid("e"), parents: [oid("a")], timestamp: 2, subject: "Feature change" },
    { id: oid("a"), parents: [], timestamp: 1, subject: "Initial" },
]
test("no-ff merge nests only the merged branch and preserves common mainline entries", () => {
    const tree = history_tree(commits)
    assert.deepEqual(tree.map(item => item.commit.id), [oid("f"), oid("d"), oid("a")])
    assert.deepEqual(tree[0].children.map(item => item.commit.id), [oid("e")])
    assert.equal(tree[1].children.length, 0)
    const graph = history_graph(commits, [{ name: "refs/tags/v1", hash: oid("b"), commit: oid("f") }], "https://repo.example.com/test/_/log")
    assert.equal(graph.edges.length, 4)
    assert.equal(graph.nodes[0].info, "v1")
    assert.deepEqual(graph.nodes.map(node => node.y), [30, 160, 290, 420])
})
test("history validation rejects malformed, duplicate, oversized and date-invalid snapshots", () => {
    assert.deepEqual(history_commits({ commits }), commits)
    for (const value of [{ commits: [...commits, commits[0]] }, { commits: [{ ...commits[0], timestamp: Infinity }] }, { commits: [{ ...commits[0], parents: ["invalid"] }] }, { commits: Array(101).fill(commits[0]) }]) assert.throws(() => history_commits(value))
    assert.throws(() => history_refs({ refs: [{ name: "config", hash: oid("f") }] }))
    assert.deepEqual(history_tree([{ ...commits[0], parents: [oid("f"), oid("f")] }])[0].children, [])
})

test("nested merges retain their inner branch groups without duplicating common ancestors", () => {
    const nested = [commits[0], commits[1], { ...commits[2], parents: [oid("b"), oid("c")] },
        { ...commits[1], id: oid("b") }, { ...commits[1], id: oid("c") }, commits[3]]
    const tree = history_tree(nested)
    assert.equal(tree[0].children[0].commit.id, oid("e"))
    assert.deepEqual(tree[0].children.map(item => item.commit.id), [oid("e"), oid("b")])
    assert.deepEqual(tree[0].children[0].children.map(item => item.commit.id), [oid("c")])
    const ids: string[] = []
    const visit = (entries: ReturnType<typeof history_tree>) => { for (const entry of entries) { ids.push(entry.commit.id); visit(entry.children) } }
    visit(tree)
    assert.equal(new Set(ids).size, nested.length)
    assert.equal(ids.length, nested.length)
})
