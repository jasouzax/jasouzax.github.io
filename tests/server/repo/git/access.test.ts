/* Real token verification and per-project collaborator restrictions, without running Git or a network service. */
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { authorize, make_throttle } from "../../../../server/repo/git/http.ts"
import { hash_token, type Server_Config } from "../../../../server/config/repositories.ts"

test("confidential repositories require a matching collaborator or owner token", () => {
    const root = mkdtempSync(join(tmpdir(), "jazu-access-"))
    try {
        writeFileSync(join(root, "HEAD"), "ref: refs/heads/main\n")
        const config: Server_Config = { file: "", repos_dir: root, state_dir: root, site: { project: "example", dir: root, branch: "main" }, projects: { example: { visibility: "public", confidental: true, collaborators: ["allowed@example.com"], path: root } }, collaborators: { allowed: { role: "read", email: "allowed@example.com", token_hash: hash_token("allowed-token") }, other: { role: "read", email: "other@example.com", token_hash: hash_token("other-token") }, owner: { role: "owner", token_hash: hash_token("owner-token") } } }
        const check = (name?: string) => authorize(config, make_throttle(), "example", "git-upload-pack", name ? `Basic ${Buffer.from(`${name}:${name}-token`).toString("base64")}` : undefined).status
        assert.equal(check(), 401)
        assert.equal(check("allowed"), 200)
        assert.equal(check("other"), 403)
        assert.equal(check("owner"), 200)
    } finally { rmSync(root, { recursive: true, force: true }) }
})
