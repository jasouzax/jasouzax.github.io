/* Shared namespace constraints must agree before content becomes a hostname or server path. */
import { test } from "node:test"
import assert from "node:assert/strict"
import { valid_subdomain_id, valid_demo_host } from "../../../shared/content/ids.ts"

test("project and Work IDs use DNS labels and reserve service names", () => {
    for (const id of ["a", "my-project", "a".repeat(63)]) assert(valid_subdomain_id(id), id)
    for (const id of ["", "-a", "a-", "a_b", "A", "a".repeat(64), "xn--example", "www", "repo", "registry", "staging", "ppl", "api", "mail", "apt", "dnf", "npm", "pypi", "v2", "v123", "example-demo", "example-server"]) assert(!valid_subdomain_id(id), id)
    assert(valid_demo_host("preview-demo"))
    assert(!valid_demo_host("api-demo"))
    assert(!valid_demo_host("a".repeat(59) + "-demo"))
})
