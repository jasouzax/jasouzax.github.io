/** Real Git metadata includes merge parents and peeled annotated tags without changing the working repository. */
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execFileSync } from "node:child_process"
import { git_read } from "../../../server/repo/index.ts"
import { history_commits, history_refs } from "../../../shared/repo/history.ts"

test("repository history returns a real no-ff DAG and annotated tag commit", async () => {
    const root = mkdtempSync(join(tmpdir(), "jazu-history-"))
    const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim()
    try {
        git("init", "--initial-branch=main"); git("config", "user.name", "History test"); git("config", "user.email", "history@example.invalid")
        writeFileSync(join(root, "base"), "base"); git("add", "."); git("commit", "-m", "Initial")
        git("checkout", "-b", "feature"); writeFileSync(join(root, "feature"), "feature"); git("add", "."); git("commit", "-m", "Feature change")
        git("checkout", "main"); writeFileSync(join(root, "main"), "main"); git("add", "."); git("commit", "-m", "Main change")
        git("merge", "--no-ff", "feature", "-m", "Merge feature"); git("tag", "-a", "v1", "-m", "Release")
        const url = new URL("https://repo.example.com/example/_/log")
        const commits = history_commits(await git_read(root, "log", url).json())
        assert.equal(commits[0].subject, "Merge feature")
        assert.equal(commits[0].parents.length, 2)
        assert.equal(commits.length, 4)
        const tag = history_refs(await git_read(root, "refs", url).json()).find(ref => ref.name === "refs/tags/v1")!
        assert.equal(tag.commit, commits[0].id)
        assert.notEqual(tag.hash, tag.commit)
        assert.equal(git_read(root, "log", new URL(`${url}?ref=--all`)).status, 400)
    } finally { rmSync(root, { recursive: true, force: true }) }
})
