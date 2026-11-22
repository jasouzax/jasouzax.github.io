/* Repository declarations preserve fallback order and never publish restricted remotes. */
import { test } from "node:test"
import assert from "node:assert/strict"
import { repo_sources, repository_remote } from "../../../shared/content/repo.ts"
import { clone_origins, project_declarations } from "../../../shared/content/pipeline.ts"
import { parse_xml } from "../../../shared/content/xml.ts"

test("typed sources preserve order and bare Git URLs remain supported", () => {
    const sources = repo_sources("npm:@owner/app,git:https://example.com/app.git,docker:ghcr.io/owner/app,pypi:app,deb:https://example.com/apt,rpm:https://example.com/rpm")
    assert.deepEqual(sources.map(source => source.type), ["npm", "git", "docker", "pypi", "deb", "rpm"])
    assert.equal(repository_remote("npm:@owner/app,git:https://example.com/app.git"), "https://example.com/app.git")
    assert.equal(repository_remote("https://example.com/app.git"), "https://example.com/app.git")
    assert.equal(repository_remote("npm:@owner/app"), undefined)
    for (const source of ["git:https://secret@example.com/app", "deb:http://example.com/apt", "npm:../app", "docker:https://example.com/app", "npm:"]) assert.throws(() => repo_sources(source), source)
})

test("private and confidential projects never produce anonymous clone origins", () => {
    const xml = '<project id="open" name="Open" date="2026" repo="git:https://example.com/open"/><project id="hidden" name="Hidden" date="2026" repo="https://example.com/hidden" private/><project id="restricted" name="Restricted" date="2026" repo="https://example.com/restricted" confidental/>'
    assert.deepEqual({ ...clone_origins(project_declarations(parse_xml(xml, "projects.xml"))) }, { open: "https://example.com/open.git" })
})
